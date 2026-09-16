"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
/*
 * Copyright (c) 2018 Tencent. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
const abstract_client_1 = require("../../../common/abstract_client");
/**
 * dataagent client
 * @class
 */
class Client extends abstract_client_1.AbstractClient {
    constructor(clientConfig) {
        super("dataagent.tencentcloudapi.com", "2025-05-13", clientConfig);
    }
    /**
     * 上传提交文件
     */
    async UploadAndCommitFile(req, cb) {
        return this.request("UploadAndCommitFile", req, cb);
    }
    /**
     * 编辑修改分片
     */
    async ModifyChunk(req, cb) {
        return this.request("ModifyChunk", req, cb);
    }
    /**
     * 文档切片删除
     */
    async DeleteChunk(req, cb) {
        return this.request("DeleteChunk", req, cb);
    }
    /**
     * 查询上传任务
     */
    async GetUploadJobDetails(req, cb) {
        return this.request("GetUploadJobDetails", req, cb);
    }
    /**
     * 获取知识库列表
     */
    async GetKnowledgeBaseList(req, cb) {
        return this.request("GetKnowledgeBaseList", req, cb);
    }
    /**
     * 文档切片新增
     */
    async AddChunk(req, cb) {
        return this.request("AddChunk", req, cb);
    }
    /**
     * 提供DataAgent 产品服务API
     */
    async ChatAI(req, cb) {
        return this.request("ChatAI", req, cb);
    }
    /**
     * 生成DataAgent 会话ID
     */
    async CreateDataAgentSession(req, cb) {
        return this.request("CreateDataAgentSession", req, cb);
    }
    /**
     * 查询场景列表
     */
    async QuerySceneList(req, cb) {
        return this.request("QuerySceneList", req, cb);
    }
    /**
     * 操作知识库
     */
    async ModifyKnowledgeBase(req, cb) {
        return this.request("ModifyKnowledgeBase", req, cb);
    }
    /**
     * 修改对象权限
     */
    async ModifyUserAuthority(req, cb) {
        return this.request("ModifyUserAuthority", req, cb);
    }
    /**
     * 删除场景
     */
    async DeleteScene(req, cb) {
        return this.request("DeleteScene", req, cb);
    }
    /**
     * 删除会话
     */
    async DeleteDataAgentSession(req, cb) {
        return this.request("DeleteDataAgentSession", req, cb);
    }
    /**
     * 新增场景
     */
    async AddScene(req, cb) {
        return this.request("AddScene", req, cb);
    }
    /**
     * 查询对象权限
     */
    async QueryUserAuthority(req, cb) {
        return this.request("QueryUserAuthority", req, cb);
    }
    /**
     * 文档切片查询
     */
    async QueryChunkList(req, cb) {
        return this.request("QueryChunkList", req, cb);
    }
    /**
     * 获取知识库文件信息列表
     */
    async GetKnowledgeBaseFileList(req, cb) {
        return this.request("GetKnowledgeBaseFileList", req, cb);
    }
    /**
     * 获取用户会话记录详情列表
     */
    async GetSessionDetails(req, cb) {
        return this.request("GetSessionDetails", req, cb);
    }
    /**
     * 更新场景
     */
    async UpdateScene(req, cb) {
        return this.request("UpdateScene", req, cb);
    }
    /**
     * 根据知识库id查询jobs 列表
     */
    async GetJobsByKnowledgeBaseId(req, cb) {
        return this.request("GetJobsByKnowledgeBaseId", req, cb);
    }
    /**
     * 中断DataAgent的回答输出
     */
    async StopChatAI(req, cb) {
        return this.request("StopChatAI", req, cb);
    }
}
exports.Client = Client;
