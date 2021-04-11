let request = require('request');
let url = require('url');
import { Channel } from './channel';
import { Log } from './../log';
let _ = require('lodash');

export class PrivateChannel {
    /**
     * Create a new private channel instance.
     */
    constructor(private options: any) {
        this.request = request;
        this.batch = [];
        this.debouncedRequest = this.options.batch?.maxWait && this.options.batch?.wait
            ? _.debounce(this.serverRequest, this.options.batch.wait, { maxWait: this.options.batch.maxWait })
            : this.serverRequest;
    }

    /**
     * Request client.
     */
    private request: any;

    /**
     * Limiter.
     */
    private batch: any;

    /**
     * DebunceRequest.
     */
    private debouncedRequest: any;

    /**
     * Send authentication request to application server.
     */
    authenticate(socket: any, data: any): Promise<any> {
        let options = {
            form: { channel_name: data.channel },
            headers: (data.auth && data.auth.headers) ? data.auth.headers : {},
        };
        options.headers = this.prepareHeaders(socket, options);

        if (this.options.devMode) {
            Log.info(`[${new Date().toISOString()}] - ${data.channel} added to batch\n`);
        }


        return new Promise<any>((resolve, reject) => {
            this.batch.push({
                options,
                cb: (error, response, body) => this.handleResponse(error, response, body, resolve, reject, options, socket)
            });

            if (this.options?.batch?.maxItems && this.batch.length > this.options.batch.maxItems) {
                this.serverRequest();
            } else {
                this.debouncedRequest();
            }
        });
    }

    protected handleResponse(error, response, body, resolve, reject, options, socket) {
        if (error) {
            if (this.options.devMode) {
                Log.error(`[${new Date().toISOString()}] - Error authenticating ${socket.id} for ${options.form.channel_name}`);
                Log.error(error);
            }

            reject({ reason: 'Error sending authentication request.', status: 0 });
        } else if (response.statusCode !== 200) {
            if (this.options.devMode) {
                Log.warning(`[${new Date().toISOString()}] - ${socket.id} could not be authenticated to ${options.form.channel_name}`);
                Log.error(response.body);
            }

            reject({ reason: 'Client can not be authenticated, got HTTP status ' + response.statusCode, status: response.statusCode });
        } else {
            if (this.options.devMode) {
                Log.info(`[${new Date().toISOString()}] - ${socket.id} authenticated for: ${options.form.channel_name}`);
            }

            resolve(body);
        }
    }
    /**
     * Check if there is a matching auth host.
     */
    protected hasMatchingHost(referer: any, host: any): boolean {
        return (referer.hostname && referer.hostname.substr(referer.hostname.indexOf('.')) === host) ||
            `${referer.protocol}//${referer.host}` === host ||
            referer.host === host;
    }

    /**
     * Send a request to the server.
     */
    protected serverRequest() {
        if (this.batch.length === 0) {
            return;
        }

        const start = new Date();
        Log.info(`[${new Date().toISOString()}] - sending request items.length = ${this.batch.length}\n`);
        const batch = this.batch;
        this.batch = [];
        const authHost = this.options.authHost ? this.options.authHost : this.options.host;

        let options = {
            url:  authHost + this.options.authEndpoint + '/batch',
            form: { batch },
            rejectUnauthorized: false,
        };

        this.request.post(options, (error, response, batchBodyRaw, next) => {
            const batchBody = JSON.parse(batchBodyRaw);
            Log.info(`[${new Date().toISOString()}] - recevied batch with batchBody.length = ${batchBody.length} at ${new Date().getMilliseconds() - start.getMilliseconds()}ms\n`);
            batchBody.forEach(({body, status}, index) => {
                response.statusCode = status;
                batch[index].cb(status !== 200 ? body : null, response, body, next)
            });
        });
    }

    /**
     * Prepare headers for request to app server.
     */
    protected prepareHeaders(socket: any, options: any): any {
        options.headers['Cookie'] = options.headers['Cookie'] || socket.request.headers.cookie;
        options.headers['X-Requested-With'] = 'XMLHttpRequest';

        return options.headers;
    }
}
