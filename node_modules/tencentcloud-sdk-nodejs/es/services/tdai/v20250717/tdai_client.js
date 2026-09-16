import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("tdai.tencentcloudapi.com", "2025-07-17", clientConfig);
    }
    async DescribeChatDetail(req, cb) {
        return this.request("DescribeChatDetail", req, cb);
    }
    async RemoveChat(req, cb) {
        return this.request("RemoveChat", req, cb);
    }
    async IsolateAgentInstance(req, cb) {
        return this.request("IsolateAgentInstance", req, cb);
    }
    async ContinueAgentWork(req, cb) {
        return this.request("ContinueAgentWork", req, cb);
    }
    async DescribeAgentDutyTasks(req, cb) {
        return this.request("DescribeAgentDutyTasks", req, cb);
    }
    async PauseAgentWork(req, cb) {
        return this.request("PauseAgentWork", req, cb);
    }
    async DescribeChats(req, cb) {
        return this.request("DescribeChats", req, cb);
    }
    async DescribeAgentInstance(req, cb) {
        return this.request("DescribeAgentInstance", req, cb);
    }
    async CreateChatCompletion(req, cb) {
        return this.request("CreateChatCompletion", req, cb);
    }
    async ModifyChatTitle(req, cb) {
        return this.request("ModifyChatTitle", req, cb);
    }
    async DescribeAgentDutyTaskDetail(req, cb) {
        return this.request("DescribeAgentDutyTaskDetail", req, cb);
    }
    async DescribeReportUrl(req, cb) {
        return this.request("DescribeReportUrl", req, cb);
    }
    async TerminateAgentInstance(req, cb) {
        return this.request("TerminateAgentInstance", req, cb);
    }
    async RecoverAgentInstance(req, cb) {
        return this.request("RecoverAgentInstance", req, cb);
    }
    async ModifyAgentInstanceParameters(req, cb) {
        return this.request("ModifyAgentInstanceParameters", req, cb);
    }
    async DescribeAgentInstances(req, cb) {
        return this.request("DescribeAgentInstances", req, cb);
    }
    async StartAgentTask(req, cb) {
        return this.request("StartAgentTask", req, cb);
    }
    async DescribeAgents(req, cb) {
        return this.request("DescribeAgents", req, cb);
    }
    async CreateAgentInstance(req, cb) {
        return this.request("CreateAgentInstance", req, cb);
    }
}
