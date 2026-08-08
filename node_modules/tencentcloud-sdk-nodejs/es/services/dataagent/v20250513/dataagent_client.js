import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("dataagent.tencentcloudapi.com", "2025-05-13", clientConfig);
    }
    async UploadAndCommitFile(req, cb) {
        return this.request("UploadAndCommitFile", req, cb);
    }
    async ModifyChunk(req, cb) {
        return this.request("ModifyChunk", req, cb);
    }
    async DeleteChunk(req, cb) {
        return this.request("DeleteChunk", req, cb);
    }
    async GetUploadJobDetails(req, cb) {
        return this.request("GetUploadJobDetails", req, cb);
    }
    async GetKnowledgeBaseList(req, cb) {
        return this.request("GetKnowledgeBaseList", req, cb);
    }
    async AddChunk(req, cb) {
        return this.request("AddChunk", req, cb);
    }
    async ChatAI(req, cb) {
        return this.request("ChatAI", req, cb);
    }
    async CreateDataAgentSession(req, cb) {
        return this.request("CreateDataAgentSession", req, cb);
    }
    async QuerySceneList(req, cb) {
        return this.request("QuerySceneList", req, cb);
    }
    async ModifyKnowledgeBase(req, cb) {
        return this.request("ModifyKnowledgeBase", req, cb);
    }
    async ModifyUserAuthority(req, cb) {
        return this.request("ModifyUserAuthority", req, cb);
    }
    async DeleteScene(req, cb) {
        return this.request("DeleteScene", req, cb);
    }
    async DeleteDataAgentSession(req, cb) {
        return this.request("DeleteDataAgentSession", req, cb);
    }
    async AddScene(req, cb) {
        return this.request("AddScene", req, cb);
    }
    async QueryUserAuthority(req, cb) {
        return this.request("QueryUserAuthority", req, cb);
    }
    async QueryChunkList(req, cb) {
        return this.request("QueryChunkList", req, cb);
    }
    async GetKnowledgeBaseFileList(req, cb) {
        return this.request("GetKnowledgeBaseFileList", req, cb);
    }
    async GetSessionDetails(req, cb) {
        return this.request("GetSessionDetails", req, cb);
    }
    async UpdateScene(req, cb) {
        return this.request("UpdateScene", req, cb);
    }
    async GetJobsByKnowledgeBaseId(req, cb) {
        return this.request("GetJobsByKnowledgeBaseId", req, cb);
    }
    async StopChatAI(req, cb) {
        return this.request("StopChatAI", req, cb);
    }
}
