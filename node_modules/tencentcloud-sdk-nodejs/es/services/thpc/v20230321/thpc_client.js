import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("thpc.tencentcloudapi.com", "2023-03-21", clientConfig);
    }
    async DescribeAutoScalingConfiguration(req, cb) {
        return this.request("DescribeAutoScalingConfiguration", req, cb);
    }
    async DeleteNodes(req, cb) {
        return this.request("DeleteNodes", req, cb);
    }
    async TerminateWorkspaces(req, cb) {
        return this.request("TerminateWorkspaces", req, cb);
    }
    async ModifyWorkspacesAttribute(req, cb) {
        return this.request("ModifyWorkspacesAttribute", req, cb);
    }
    async CreateCluster(req, cb) {
        return this.request("CreateCluster", req, cb);
    }
    async CreateWorkspaces(req, cb) {
        return this.request("CreateWorkspaces", req, cb);
    }
    async DescribeQueues(req, cb) {
        return this.request("DescribeQueues", req, cb);
    }
    async AddNodes(req, cb) {
        return this.request("AddNodes", req, cb);
    }
    async DescribeJobs(req, cb) {
        return this.request("DescribeJobs", req, cb);
    }
    async DeleteCluster(req, cb) {
        return this.request("DeleteCluster", req, cb);
    }
    async DetachNodes(req, cb) {
        return this.request("DetachNodes", req, cb);
    }
    async DeleteClusterStorageOption(req, cb) {
        return this.request("DeleteClusterStorageOption", req, cb);
    }
    async DescribeWorkspaces(req, cb) {
        return this.request("DescribeWorkspaces", req, cb);
    }
    async TerminateJob(req, cb) {
        return this.request("TerminateJob", req, cb);
    }
    async DescribeNodes(req, cb) {
        return this.request("DescribeNodes", req, cb);
    }
    async DescribeClusters(req, cb) {
        return this.request("DescribeClusters", req, cb);
    }
    async ModifyNodeAttribute(req, cb) {
        return this.request("ModifyNodeAttribute", req, cb);
    }
    async SetAutoScalingConfiguration(req, cb) {
        return this.request("SetAutoScalingConfiguration", req, cb);
    }
    async AddQueue(req, cb) {
        return this.request("AddQueue", req, cb);
    }
    async DescribeInitNodeScripts(req, cb) {
        return this.request("DescribeInitNodeScripts", req, cb);
    }
    async AttachNodes(req, cb) {
        return this.request("AttachNodes", req, cb);
    }
    async DescribeJobSubmitInfo(req, cb) {
        return this.request("DescribeJobSubmitInfo", req, cb);
    }
    async DescribeClusterActivities(req, cb) {
        return this.request("DescribeClusterActivities", req, cb);
    }
    async SubmitJob(req, cb) {
        return this.request("SubmitJob", req, cb);
    }
    async DescribeClusterStorageOption(req, cb) {
        return this.request("DescribeClusterStorageOption", req, cb);
    }
    async ModifyClusterDeletionProtection(req, cb) {
        return this.request("ModifyClusterDeletionProtection", req, cb);
    }
    async ModifyInitNodeScripts(req, cb) {
        return this.request("ModifyInitNodeScripts", req, cb);
    }
    async AddClusterStorageOption(req, cb) {
        return this.request("AddClusterStorageOption", req, cb);
    }
    async DescribeJobsOverview(req, cb) {
        return this.request("DescribeJobsOverview", req, cb);
    }
    async DeleteJob(req, cb) {
        return this.request("DeleteJob", req, cb);
    }
    async ModifyWorkspacesRenewFlag(req, cb) {
        return this.request("ModifyWorkspacesRenewFlag", req, cb);
    }
    async DeleteQueue(req, cb) {
        return this.request("DeleteQueue", req, cb);
    }
}
