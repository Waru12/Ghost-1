const sinon = require('sinon');
const {agentProvider, fixtureManager, mockManager} = require('../../../utils/e2e-framework');
const assert = require('assert');
const models = require('../../../../core/server/models');
const domainEvents = require('@tryghost/domain-events');
const MailgunClient = require('@tryghost/mailgun-client');
const {run} = require('../../../../core/server/services/email-analytics/jobs/fetch-latest/run.js');
const membersService = require('../../../../core/server/services/members');
const {EmailDeliveredEvent} = require('@tryghost/email-events');

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function resetFailures(emailId) {
    await models.EmailRecipientFailure.destroy({
        destroyBy: {
            email_id: emailId
        }   
    });
}

// Test the whole E2E flow from Mailgun events -> handling and storage
describe('EmailEventStorage', function () {
    let _mailgunClient;
    let agent;
    let events = [];
    let jobsService;

    before(async function () {
        agent = await agentProvider.getAdminAPIAgent();
        await fixtureManager.init('newsletters', 'members:newsletters', 'members:emails');
        await agent.loginAsOwner();

        // Only create reference to jobsService after Ghost boot
        jobsService = require('../../../../core/server/services/jobs');

        sinon.stub(MailgunClient.prototype, 'fetchEvents').callsFake(async function (_, batchHandler) {
            const normalizedEvents = events.map(this.normalizeEvent) || [];
            return [await batchHandler(normalizedEvents)];
        });
    });

    it('Can handle delivered events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        events = [{
            event: 'delivered',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(initialModel.get('delivered_at'), null);

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.delivered, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(100);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(updatedEmailRecipient.get('delivered_at').toUTCString(), timestamp.toUTCString());
    });

    it('Can handle delivered events without user variables', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        // Reset
        await models.EmailRecipient.edit({delivered_at: null}, {
            id: emailRecipient.id
        });

        events = [{
            event: 'delivered',
            recipient: emailRecipient.member_email,
            'user-variables': {},
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(initialModel.get('delivered_at'), null);

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.delivered, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(100);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(updatedEmailRecipient.get('delivered_at').toUTCString(), timestamp.toUTCString());
    });

    it('Can handle opened events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        events = [{
            event: 'opened',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(initialModel.get('opened_at'), null);

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.opened, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(100);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(updatedEmailRecipient.get('opened_at').toUTCString(), timestamp.toUTCString());

        // TODO: check last seen at
    });

    it('Can handle permanent failure events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        events = [{
            event: 'failed',
            id: 'pl271FzxTTmGRW8Uj3dUWw',
            'log-level': 'error',
            severity: 'permanent',
            reason: 'suppress-bounce',
            envelope: {
                sender: 'john@example.org',
                transport: 'smtp',
                targets: 'joan@example.com'
            },
            flags: {
                'is-routed': false,
                'is-authenticated': true,
                'is-system-test': false,
                'is-test-mode': false
            },
            'delivery-status': {
                'attempt-no': 1,
                message: '',
                code: 605,
                description: 'Not delivering to previously bounced address',
                'session-seconds': 0.0
            },
            message: {
                headers: {
                    to: 'joan@example.com',
                    'message-id': providerId,
                    from: 'john@example.org',
                    subject: 'Test Subject'
                },
                attachments: [],
                size: 867
            },
            storage: {
                url: 'https://se.api.mailgun.net/v3/domains/example.org/messages/eyJwI...',
                key: 'eyJwI...'
            },
            recipient: emailRecipient.member_email,
            'recipient-domain': 'mailgun.com',
            campaigns: [],
            tags: [],
            'user-variables': {},
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(initialModel.get('failed_at'), null);
        assert.notEqual(initialModel.get('delivered_at'), null);

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.permanentFailed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(updatedEmailRecipient.get('failed_at').toUTCString(), timestamp.toUTCString());
        
        // Check delivered at is reset back to null
        assert.equal(updatedEmailRecipient.get('delivered_at'), null);

        // Check we have a stored permanent failure
        const permanentFailures = await models.EmailRecipientFailure.findAll({
            filter: `email_recipient_id:${emailRecipient.id}`
        });
        assert.equal(permanentFailures.length, 1);

        assert.equal(permanentFailures.models[0].get('message'), 'Not delivering to previously bounced address');
        assert.equal(permanentFailures.models[0].get('code'), 605);
        assert.equal(permanentFailures.models[0].get('enhanced_code'), null);
        assert.equal(permanentFailures.models[0].get('email_id'), emailId);
        assert.equal(permanentFailures.models[0].get('member_id'), memberId);
        assert.equal(permanentFailures.models[0].get('event_id'), 'pl271FzxTTmGRW8Uj3dUWw');
        assert.equal(permanentFailures.models[0].get('severity'), 'permanent');
        assert.equal(permanentFailures.models[0].get('failed_at').toUTCString(), timestamp.toUTCString());

        // Sometimes we emit events outside of order beacuse of the TRUST_THRESHOLD of the provider-mailgun class.
        // Check if we handle this correctly.
        // Manually emit the delivered event again, and see if it is ignored correctly
        // @ts-ignore
        domainEvents.dispatch(EmailDeliveredEvent.create({
            email: emailRecipient.member_email,
            emailRecipientId: emailRecipient.id,
            memberId: memberId,
            emailId: emailId,
            timestamp
        }));

        // Now wait for events processed
        await sleep(200);

        // Check delivered at is not set again
        const updatedEmailRecipient2 = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(updatedEmailRecipient2.get('failed_at').toUTCString(), timestamp.toUTCString());
        
        // Check delivered at is reset back to null
        assert.equal(updatedEmailRecipient2.get('delivered_at'), null, 'A delivered event after a permanent failure event should be ignored');
    });

    it('Ignores permanent failures if already failed', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2001, 0, 1);

        events = [{
            event: 'failed',
            id: 'pl271FzxTTmGRW8Uj3dUWw2',
            'log-level': 'error',
            severity: 'permanent',
            reason: 'suppress-bounce',
            envelope: {
                sender: 'john@example.org',
                transport: 'smtp',
                targets: 'joan@example.com'
            },
            flags: {
                'is-routed': false,
                'is-authenticated': true,
                'is-system-test': false,
                'is-test-mode': false
            },
            'delivery-status': {
                'attempt-no': 1,
                message: '',
                code: 500,
                description: 'Different message',
                'session-seconds': 0.0
            },
            message: {
                headers: {
                    to: 'joan@example.com',
                    'message-id': providerId,
                    from: 'john@example.org',
                    subject: 'Test Subject'
                },
                attachments: [],
                size: 867
            },
            storage: {
                url: 'https://se.api.mailgun.net/v3/domains/example.org/messages/eyJwI...',
                key: 'eyJwI...'
            },
            recipient: emailRecipient.member_email,
            'recipient-domain': 'mailgun.com',
            campaigns: [],
            tags: [],
            'user-variables': {},
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.notEqual(initialModel.get('failed_at'), null, 'This test requires a failed email recipient');

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.permanentFailed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        // Not changed failed_at
        assert.equal(updatedEmailRecipient.get('failed_at').toUTCString(), initialModel.get('failed_at').toUTCString());

        // Check we have a stored permanent failure
        const permanentFailures = await models.EmailRecipientFailure.findAll({
            filter: `email_recipient_id:${emailRecipient.id}`
        });
        assert.equal(permanentFailures.length, 1);

        // Message and code not changed
        assert.equal(permanentFailures.models[0].get('message'), 'Not delivering to previously bounced address');
        assert.equal(permanentFailures.models[0].get('code'), 605);
        assert.equal(permanentFailures.models[0].get('enhanded_code'), null);
        assert.notEqual(permanentFailures.models[0].get('failed_at').toUTCString(), timestamp.toUTCString());
    });

    it('Can handle temporary failure events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        // Reset
        await models.EmailRecipient.edit({failed_at: null}, {
            id: emailRecipient.id
        });
        await resetFailures(emailId);

        events = [{
            event: 'failed',
            severity: 'temporary',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000),
            tags: [],
            storage: {
                url: 'https://storage-us-east4.api.mailgun.net/v3/domains/...',
                region: 'us-east4',
                key: 'AwABB...',
                env: 'production'
            },
            'delivery-status': {
                tls: true,
                'mx-host': 'hotmail-com.olc.protection.outlook.com',
                code: 451,
                description: '',
                'session-seconds': 0.7517080307006836,
                utf8: true,
                'retry-seconds': 600,
                'enhanced-code': '4.7.652',
                'attempt-no': 1,
                message: '4.7.652 The mail server [xxx.xxx.xxx.xxx] has exceeded the maximum number of connections.',
                'certificate-verified': true
            },
            batch: {
                id: '633ee6154618b2fed628ccb0'
            },
            'recipient-domain': 'test.com',
            id: 'xYrATi63Rke8EC_s7EoJeA',
            campaigns: [],
            reason: 'generic',
            flags: {
                'is-routed': false,
                'is-authenticated': true,
                'is-system-test': false,
                'is-test-mode': false
            },
            'log-level': 'warn',
            template: {
                name: 'test'
            },
            envelope: {
                transport: 'smtp',
                sender: 'test@test.com',
                'sending-ip': 'xxx.xxx.xxx.xxx',
                targets: 'test@test.com'
            },
            message: {
                headers: {
                    to: 'test@test.net',
                    'message-id': providerId,
                    from: 'test@test.com',
                    subject: 'Test send'
                },
                attachments: [],
                size: 3499
            }
        }];

        const initialModel = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        assert.equal(initialModel.get('failed_at'), null);

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.temporaryFailed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        // Not mark as failed
        assert.equal(updatedEmailRecipient.get('failed_at'), null);

        // Check we have a stored temporary failure
        const failures = await models.EmailRecipientFailure.findAll({
            filter: `email_recipient_id:${emailRecipient.id}`
        });
        assert.equal(failures.length, 1);

        assert.equal(failures.models[0].get('email_id'), emailId);
        assert.equal(failures.models[0].get('member_id'), memberId);
        assert.equal(failures.models[0].get('severity'), 'temporary');
        assert.equal(failures.models[0].get('event_id'), 'xYrATi63Rke8EC_s7EoJeA');
        assert.equal(failures.models[0].get('message'), '4.7.652 The mail server [xxx.xxx.xxx.xxx] has exceeded the maximum number of connections.');
        assert.equal(failures.models[0].get('code'), 451);
        assert.equal(failures.models[0].get('enhanced_code'), '4.7.652');
        assert.equal(failures.models[0].get('failed_at').toUTCString(), timestamp.toUTCString());
    });

    it('Correctly overwrites temporary failure event with other temporary one', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2001, 0, 1);

        events = [{
            event: 'failed',
            severity: 'temporary',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000),
            tags: [],
            storage: {
                url: 'https://storage-us-east4.api.mailgun.net/v3/domains/...',
                region: 'us-east4',
                key: 'AwABB...',
                env: 'production'
            },
            'delivery-status': {
                tls: true,
                code: 555,
                description: '',
                utf8: true,
                'retry-seconds': 600,
                'attempt-no': 1,
                message: 'New error message failure',
                'certificate-verified': true
            },
            batch: {
                id: '633ee6154618b2fed628ccb0'
            },
            'recipient-domain': 'test.com',
            id: 'updated_event_id',
            campaigns: [],
            reason: 'generic',
            flags: {
                'is-routed': false,
                'is-authenticated': true,
                'is-system-test': false,
                'is-test-mode': false
            },
            'log-level': 'warn',
            template: {
                name: 'test'
            },
            envelope: {
                transport: 'smtp',
                sender: 'test@test.com',
                'sending-ip': 'xxx.xxx.xxx.xxx',
                targets: 'test@test.com'
            },
            message: {
                headers: {
                    to: 'test@test.net',
                    'message-id': providerId,
                    from: 'test@test.com',
                    subject: 'Test send'
                },
                attachments: [],
                size: 3499
            }
        }];

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.temporaryFailed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        // Not mark as failed
        assert.equal(updatedEmailRecipient.get('failed_at'), null);

        // Check we have a stored temporary failure
        const failures = await models.EmailRecipientFailure.findAll({
            filter: `email_recipient_id:${emailRecipient.id}`
        });
        assert.equal(failures.length, 1);

        assert.equal(failures.models[0].get('email_id'), emailId);
        assert.equal(failures.models[0].get('member_id'), memberId);
        assert.equal(failures.models[0].get('severity'), 'temporary');
        assert.equal(failures.models[0].get('event_id'), 'updated_event_id');
        assert.equal(failures.models[0].get('message'), 'New error message failure');
        assert.equal(failures.models[0].get('code'), 555);
        assert.equal(failures.models[0].get('enhanced_code'), null); // should be set to null instead of kept
        assert.equal(failures.models[0].get('failed_at').toUTCString(), timestamp.toUTCString());
    });

    it('Correctly overwrites permanent failure event with other permanent one', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2001, 0, 1);

        events = [{
            event: 'failed',
            severity: 'permanent',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000),
            tags: [],
            storage: {
                url: 'https://storage-us-east4.api.mailgun.net/v3/domains/...',
                region: 'us-east4',
                key: 'AwABB...',
                env: 'production'
            },
            'delivery-status': {
                tls: true,
                code: 111,
                description: '',
                utf8: true,
                'retry-seconds': 600,
                'attempt-no': 1,
                message: 'New error message permanent failure',
                'certificate-verified': true
            },
            batch: {
                id: '633ee6154618b2fed628ccb0'
            },
            'recipient-domain': 'test.com',
            id: 'updated_permanent_event_id',
            campaigns: [],
            reason: 'generic',
            flags: {
                'is-routed': false,
                'is-authenticated': true,
                'is-system-test': false,
                'is-test-mode': false
            },
            'log-level': 'warn',
            template: {
                name: 'test'
            },
            envelope: {
                transport: 'smtp',
                sender: 'test@test.com',
                'sending-ip': 'xxx.xxx.xxx.xxx',
                targets: 'test@test.com'
            },
            message: {
                headers: {
                    to: 'test@test.net',
                    'message-id': providerId,
                    from: 'test@test.com',
                    subject: 'Test send'
                },
                attachments: [],
                size: 3499
            }
        }];

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.permanentFailed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if status has changed to delivered, with correct timestamp
        const updatedEmailRecipient = await models.EmailRecipient.findOne({
            id: emailRecipient.id
        }, {require: true});

        // Not mark as failed
        assert.equal(updatedEmailRecipient.get('failed_at').toUTCString(), timestamp.toUTCString());

        // Check we have a stored temporary failure
        const failures = await models.EmailRecipientFailure.findAll({
            filter: `email_recipient_id:${emailRecipient.id}`
        });
        assert.equal(failures.length, 1);

        assert.equal(failures.models[0].get('email_id'), emailId);
        assert.equal(failures.models[0].get('member_id'), memberId);
        assert.equal(failures.models[0].get('severity'), 'permanent');
        assert.equal(failures.models[0].get('event_id'), 'updated_permanent_event_id');
        assert.equal(failures.models[0].get('message'), 'New error message permanent failure');
        assert.equal(failures.models[0].get('code'), 111);
        assert.equal(failures.models[0].get('enhanced_code'), null); // should be set to null instead of kept
        assert.equal(failures.models[0].get('failed_at').toUTCString(), timestamp.toUTCString());
    });

    it('Can handle complaint events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);
        const eventsURI = '/members/events/?' + encodeURIComponent(
            `filter=type:-[comment_event,aggregated_click_event]+data.member_id:${memberId}`
        );

        // Check not unsubscribed
        const {body: {events: [notSpamEvent]}} = await agent.get(eventsURI);
        assert.notEqual(notSpamEvent.type, 'email_complaint_event', 'This test requires a member that does not have a spam event');

        events = [{
            event: 'complained',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.complained, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if event exists
        const {body: {events: [spamComplaintEvent]}} = await agent.get(eventsURI);
        assert.equal(spamComplaintEvent.type, 'email_complaint_event');
    });

    it('Can handle unsubscribe events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        // Reset
        await membersService.api.members.update({newsletters: [
            {
                id: fixtureManager.get('newsletters', 0).id
            }
        ]}, {id: memberId});

        // Check not unsubscribed
        const memberInitial = await membersService.api.members.get({id: memberId}, {withRelated: ['newsletters']});
        assert.notEqual(memberInitial.related('newsletters').length, 0, 'This test requires a member that is subscribed to at least one newsletter');

        events = [{
            event: 'unsubscribed',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.unsubscribed, 1);
        assert.deepEqual(result.emailIds, [emailId]);
        assert.deepEqual(result.memberIds, [memberId]);

        // Now wait for events processed
        await sleep(200);

        // Check if unsubscribed
        const member = await membersService.api.members.get({id: memberId}, {withRelated: ['newsletters']});
        assert.equal(member.related('newsletters').length, 0);
    });

    it('Can handle unknown events', async function () {
        const emailBatch = fixtureManager.get('email_batches', 0);
        const emailId = emailBatch.email_id;

        const emailRecipient = fixtureManager.get('email_recipients', 0);
        assert(emailRecipient.batch_id === emailBatch.id);
        const memberId = emailRecipient.member_id;
        const providerId = emailBatch.provider_id;
        const timestamp = new Date(2000, 0, 1);

        events = [{
            event: 'ceci-nest-pas-un-event',
            recipient: emailRecipient.member_email,
            'user-variables': {
                'email-id': emailId
            },
            message: {
                headers: {
                    'message-id': providerId
                }
            },
            // unix timestamp
            timestamp: Math.round(timestamp.getTime() / 1000)
        }];

        // Fire event processing
        // We use offloading to have correct coverage and usage of worker thread
        const {eventStats: result} = await run({
            domainEvents
        });
        assert.equal(result.unhandled, 1);
        assert.deepEqual(result.emailIds, []);
        assert.deepEqual(result.memberIds, []);
    });
});
