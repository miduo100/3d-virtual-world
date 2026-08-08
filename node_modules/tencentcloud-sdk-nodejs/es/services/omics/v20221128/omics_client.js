import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("omics.tencentcloudapi.com", "2022-11-28", clientConfig);
    }
    async ImportTableFile(req, cb) {
        return this.request("ImportTableFile", req, cb);
    }
    async DescribeRunGroups(req, cb) {
        return this.request("DescribeRunGroups", req, cb);
    }
    async DescribeTablesRows(req, cb) {
        return this.request("DescribeTablesRows", req, cb);
    }
    async DeleteVolumeData(req, cb) {
        return this.request("DeleteVolumeData", req, cb);
    }
    async DescribeEnvironments(req, cb) {
        return this.request("DescribeEnvironments", req, cb);
    }
    async GetRunMetadataFile(req, cb) {
        return this.request("GetRunMetadataFile", req, cb);
    }
    async CreateVolume(req, cb) {
        return this.request("CreateVolume", req, cb);
    }
    async DescribeVolumes(req, cb) {
        return this.request("DescribeVolumes", req, cb);
    }
    async GetRunStatus(req, cb) {
        return this.request("GetRunStatus", req, cb);
    }
    async RunApplication(req, cb) {
        return this.request("RunApplication", req, cb);
    }
    async RunWorkflow(req, cb) {
        return this.request("RunWorkflow", req, cb);
    }
    async CreateEnvironment(req, cb) {
        return this.request("CreateEnvironment", req, cb);
    }
    async RetryRuns(req, cb) {
        return this.request("RetryRuns", req, cb);
    }
    async TerminateRunGroup(req, cb) {
        return this.request("TerminateRunGroup", req, cb);
    }
    async DescribeRuns(req, cb) {
        return this.request("DescribeRuns", req, cb);
    }
    async DeleteVolume(req, cb) {
        return this.request("DeleteVolume", req, cb);
    }
    async ModifyVolume(req, cb) {
        return this.request("ModifyVolume", req, cb);
    }
    async DeleteEnvironment(req, cb) {
        return this.request("DeleteEnvironment", req, cb);
    }
    async DescribeTables(req, cb) {
        return this.request("DescribeTables", req, cb);
    }
    async GetRunCalls(req, cb) {
        return this.request("GetRunCalls", req, cb);
    }
}
