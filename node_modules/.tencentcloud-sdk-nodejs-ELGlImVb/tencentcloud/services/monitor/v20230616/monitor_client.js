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
 * monitor client
 * @class
 */
class Client extends abstract_client_1.AbstractClient {
    constructor(clientConfig) {
        super("monitor.tencentcloudapi.com", "2023-06-16", clientConfig);
    }
    /**
     * 删除通知内容模板
     */
    async DeleteNoticeContentTmpls(req, cb) {
        return this.request("DeleteNoticeContentTmpls", req, cb);
    }
    /**
     * 根据查询条件获取自定义通知内容模板，若所有查询条件空，则获取账号下所有模板
     */
    async DescribeNoticeContentTmpl(req, cb) {
        return this.request("DescribeNoticeContentTmpl", req, cb);
    }
    /**
     * 查询AI工作台SRE数字分身工作日志详细信息
     */
    async DescribeAIWorkbenchSREDigitalTwinWorkLogDetail(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinWorkLogDetail", req, cb);
    }
    /**
     * 创建自定义通知内容模板
     */
    async CreateNoticeContentTmpl(req, cb) {
        return this.request("CreateNoticeContentTmpl", req, cb);
    }
    /**
     * 触发数字分身任务请求
     */
    async TriggerAIWorkbenchSREDigitalTwinTask(req, cb) {
        return this.request("TriggerAIWorkbenchSREDigitalTwinTask", req, cb);
    }
    /**
     * 修改通知内容模板
     */
    async ModifyNoticeContentTmpl(req, cb) {
        return this.request("ModifyNoticeContentTmpl", req, cb);
    }
    /**
     * 查询AI工作台SRE数字分身任务工作日志列表
     */
    async DescribeAIWorkbenchSREDigitalTwinWorkLogList(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinWorkLogList", req, cb);
    }
    /**
     * 按需查询告警的通知历史
     */
    async DescribeAlarmNotifyHistories(req, cb) {
        return this.request("DescribeAlarmNotifyHistories", req, cb);
    }
    /**
     * 查询AI工作台SRE数字分身任务列表
     */
    async DescribeAIWorkbenchSREDigitalTwinTaskList(req, cb) {
        return this.request("DescribeAIWorkbenchSREDigitalTwinTaskList", req, cb);
    }
}
exports.Client = Client;
