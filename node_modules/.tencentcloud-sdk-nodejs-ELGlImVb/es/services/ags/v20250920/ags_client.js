import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("ags.tencentcloudapi.com", "2025-09-20", clientConfig);
    }
    async CreatePreCacheImageTask(req, cb) {
        return this.request("CreatePreCacheImageTask", req, cb);
    }
    async UpdateSandboxInstance(req, cb) {
        return this.request("UpdateSandboxInstance", req, cb);
    }
    async StartSandboxInstance(req, cb) {
        return this.request("StartSandboxInstance", req, cb);
    }
    async AcquireSandboxInstanceToken(req, cb) {
        return this.request("AcquireSandboxInstanceToken", req, cb);
    }
    async DescribePreCacheImageTask(req, cb) {
        return this.request("DescribePreCacheImageTask", req, cb);
    }
    async ResumeSandboxInstance(req, cb) {
        return this.request("ResumeSandboxInstance", req, cb);
    }
    async DescribeSandboxToolList(req, cb) {
        return this.request("DescribeSandboxToolList", req, cb);
    }
    async DescribeAPIKeyList(req, cb) {
        return this.request("DescribeAPIKeyList", req, cb);
    }
    async DescribeSandboxInstanceList(req, cb) {
        return this.request("DescribeSandboxInstanceList", req, cb);
    }
    async CreateAPIKey(req, cb) {
        return this.request("CreateAPIKey", req, cb);
    }
    async DeleteSandboxTool(req, cb) {
        return this.request("DeleteSandboxTool", req, cb);
    }
    async PauseSandboxInstance(req, cb) {
        return this.request("PauseSandboxInstance", req, cb);
    }
    async StopSandboxInstance(req, cb) {
        return this.request("StopSandboxInstance", req, cb);
    }
    async DeleteAPIKey(req, cb) {
        return this.request("DeleteAPIKey", req, cb);
    }
    async CreateSandboxTool(req, cb) {
        return this.request("CreateSandboxTool", req, cb);
    }
    async UpdateSandboxTool(req, cb) {
        return this.request("UpdateSandboxTool", req, cb);
    }
}
