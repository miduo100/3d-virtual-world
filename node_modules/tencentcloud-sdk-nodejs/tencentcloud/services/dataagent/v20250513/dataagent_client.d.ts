import { AbstractClient } from "../../../common/abstract_client";
import { ClientConfig } from "../../../common/interface";
import { UploadAndCommitFileRequest, GetKnowledgeBaseListRequest, AddChunkRequest, QuerySceneListResponse, ModifyChunkRequest, ChatAIResponse, DeleteChunkRequest, GetSessionDetailsResponse, QueryChunkListResponse, AddSceneRequest, GetJobsByKnowledgeBaseIdRequest, QueryChunkListRequest, StopChatAIRequest, GetSessionDetailsRequest, QueryUserAuthorityResponse, ModifyKnowledgeBaseRequest, DeleteChunkResponse, CreateDataAgentSessionResponse, ModifyUserAuthorityRequest, GetJobsByKnowledgeBaseIdResponse, QuerySceneListRequest, StopChatAIResponse, GetUploadJobDetailsResponse, UploadAndCommitFileResponse, ModifyChunkResponse, DeleteDataAgentSessionResponse, AddSceneResponse, GetKnowledgeBaseFileListResponse, ChatAIRequest, DeleteSceneResponse, QueryUserAuthorityRequest, GetKnowledgeBaseFileListRequest, GetUploadJobDetailsRequest, ModifyUserAuthorityResponse, AddChunkResponse, UpdateSceneResponse, UpdateSceneRequest, CreateDataAgentSessionRequest, ModifyKnowledgeBaseResponse, DeleteSceneRequest, DeleteDataAgentSessionRequest, GetKnowledgeBaseListResponse } from "./dataagent_models";
/**
 * dataagent client
 * @class
 */
export declare class Client extends AbstractClient {
    constructor(clientConfig: ClientConfig);
    /**
     * 上传提交文件
     */
    UploadAndCommitFile(req: UploadAndCommitFileRequest, cb?: (error: string, rep: UploadAndCommitFileResponse) => void): Promise<UploadAndCommitFileResponse>;
    /**
     * 编辑修改分片
     */
    ModifyChunk(req: ModifyChunkRequest, cb?: (error: string, rep: ModifyChunkResponse) => void): Promise<ModifyChunkResponse>;
    /**
     * 文档切片删除
     */
    DeleteChunk(req: DeleteChunkRequest, cb?: (error: string, rep: DeleteChunkResponse) => void): Promise<DeleteChunkResponse>;
    /**
     * 查询上传任务
     */
    GetUploadJobDetails(req: GetUploadJobDetailsRequest, cb?: (error: string, rep: GetUploadJobDetailsResponse) => void): Promise<GetUploadJobDetailsResponse>;
    /**
     * 获取知识库列表
     */
    GetKnowledgeBaseList(req: GetKnowledgeBaseListRequest, cb?: (error: string, rep: GetKnowledgeBaseListResponse) => void): Promise<GetKnowledgeBaseListResponse>;
    /**
     * 文档切片新增
     */
    AddChunk(req: AddChunkRequest, cb?: (error: string, rep: AddChunkResponse) => void): Promise<AddChunkResponse>;
    /**
     * 提供DataAgent 产品服务API
     */
    ChatAI(req: ChatAIRequest, cb?: (error: string, rep: ChatAIResponse) => void): Promise<ChatAIResponse>;
    /**
     * 生成DataAgent 会话ID
     */
    CreateDataAgentSession(req: CreateDataAgentSessionRequest, cb?: (error: string, rep: CreateDataAgentSessionResponse) => void): Promise<CreateDataAgentSessionResponse>;
    /**
     * 查询场景列表
     */
    QuerySceneList(req: QuerySceneListRequest, cb?: (error: string, rep: QuerySceneListResponse) => void): Promise<QuerySceneListResponse>;
    /**
     * 操作知识库
     */
    ModifyKnowledgeBase(req: ModifyKnowledgeBaseRequest, cb?: (error: string, rep: ModifyKnowledgeBaseResponse) => void): Promise<ModifyKnowledgeBaseResponse>;
    /**
     * 修改对象权限
     */
    ModifyUserAuthority(req: ModifyUserAuthorityRequest, cb?: (error: string, rep: ModifyUserAuthorityResponse) => void): Promise<ModifyUserAuthorityResponse>;
    /**
     * 删除场景
     */
    DeleteScene(req: DeleteSceneRequest, cb?: (error: string, rep: DeleteSceneResponse) => void): Promise<DeleteSceneResponse>;
    /**
     * 删除会话
     */
    DeleteDataAgentSession(req: DeleteDataAgentSessionRequest, cb?: (error: string, rep: DeleteDataAgentSessionResponse) => void): Promise<DeleteDataAgentSessionResponse>;
    /**
     * 新增场景
     */
    AddScene(req: AddSceneRequest, cb?: (error: string, rep: AddSceneResponse) => void): Promise<AddSceneResponse>;
    /**
     * 查询对象权限
     */
    QueryUserAuthority(req: QueryUserAuthorityRequest, cb?: (error: string, rep: QueryUserAuthorityResponse) => void): Promise<QueryUserAuthorityResponse>;
    /**
     * 文档切片查询
     */
    QueryChunkList(req: QueryChunkListRequest, cb?: (error: string, rep: QueryChunkListResponse) => void): Promise<QueryChunkListResponse>;
    /**
     * 获取知识库文件信息列表
     */
    GetKnowledgeBaseFileList(req: GetKnowledgeBaseFileListRequest, cb?: (error: string, rep: GetKnowledgeBaseFileListResponse) => void): Promise<GetKnowledgeBaseFileListResponse>;
    /**
     * 获取用户会话记录详情列表
     */
    GetSessionDetails(req: GetSessionDetailsRequest, cb?: (error: string, rep: GetSessionDetailsResponse) => void): Promise<GetSessionDetailsResponse>;
    /**
     * 更新场景
     */
    UpdateScene(req: UpdateSceneRequest, cb?: (error: string, rep: UpdateSceneResponse) => void): Promise<UpdateSceneResponse>;
    /**
     * 根据知识库id查询jobs 列表
     */
    GetJobsByKnowledgeBaseId(req: GetJobsByKnowledgeBaseIdRequest, cb?: (error: string, rep: GetJobsByKnowledgeBaseIdResponse) => void): Promise<GetJobsByKnowledgeBaseIdResponse>;
    /**
     * 中断DataAgent的回答输出
     */
    StopChatAI(req: StopChatAIRequest, cb?: (error: string, rep: StopChatAIResponse) => void): Promise<StopChatAIResponse>;
}
