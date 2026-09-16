import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("lkeap.tencentcloudapi.com", "2024-05-22", clientConfig);
    }
    async RetrieveKnowledge(req, cb) {
        return this.request("RetrieveKnowledge", req, cb);
    }
    async ModifyQA(req, cb) {
        return this.request("ModifyQA", req, cb);
    }
    async GetReconstructDocumentResult(req, cb) {
        return this.request("GetReconstructDocumentResult", req, cb);
    }
    async GetSplitDocumentResult(req, cb) {
        return this.request("GetSplitDocumentResult", req, cb);
    }
    async DescribeDoc(req, cb) {
        return this.request("DescribeDoc", req, cb);
    }
    async ReconstructDocumentSSE(req, cb) {
        return this.request("ReconstructDocumentSSE", req, cb);
    }
    async DeleteDocs(req, cb) {
        return this.request("DeleteDocs", req, cb);
    }
    async DeleteQAs(req, cb) {
        return this.request("DeleteQAs", req, cb);
    }
    async QueryRewrite(req, cb) {
        return this.request("QueryRewrite", req, cb);
    }
    async GetEmbedding(req, cb) {
        return this.request("GetEmbedding", req, cb);
    }
    async ModifyAttributeLabel(req, cb) {
        return this.request("ModifyAttributeLabel", req, cb);
    }
    async RunRerank(req, cb) {
        return this.request("RunRerank", req, cb);
    }
    async CancelTask(req, cb) {
        return this.request("CancelTask", req, cb);
    }
    async ListQAs(req, cb) {
        return this.request("ListQAs", req, cb);
    }
    async DeleteAttributeLabels(req, cb) {
        return this.request("DeleteAttributeLabels", req, cb);
    }
    async CreateAttributeLabel(req, cb) {
        return this.request("CreateAttributeLabel", req, cb);
    }
    async CreateReconstructDocumentFlow(req, cb) {
        return this.request("CreateReconstructDocumentFlow", req, cb);
    }
    async ListAttributeLabels(req, cb) {
        return this.request("ListAttributeLabels", req, cb);
    }
    async ListDocs(req, cb) {
        return this.request("ListDocs", req, cb);
    }
    async CreateKnowledgeBase(req, cb) {
        return this.request("CreateKnowledgeBase", req, cb);
    }
    async ImportQAs(req, cb) {
        return this.request("ImportQAs", req, cb);
    }
    async CreateQA(req, cb) {
        return this.request("CreateQA", req, cb);
    }
    async DeleteKnowledgeBase(req, cb) {
        return this.request("DeleteKnowledgeBase", req, cb);
    }
    async CreateSplitDocumentFlow(req, cb) {
        return this.request("CreateSplitDocumentFlow", req, cb);
    }
    async GetCharacterUsage(req, cb) {
        return this.request("GetCharacterUsage", req, cb);
    }
    async UploadDoc(req, cb) {
        return this.request("UploadDoc", req, cb);
    }
    async ChatCompletions(req, cb) {
        return this.request("ChatCompletions", req, cb);
    }
}
