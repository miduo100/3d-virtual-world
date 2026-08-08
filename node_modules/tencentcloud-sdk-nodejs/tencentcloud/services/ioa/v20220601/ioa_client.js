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
 * ioa client
 * @class
 */
class Client extends abstract_client_1.AbstractClient {
    constructor(clientConfig) {
        super("ioa.tencentcloudapi.com", "2022-06-01", clientConfig);
    }
    /**
     * 聚合软件的已安装终端列表
     */
    async DescribeAggrSoftDeviceList(req, cb) {
        return this.request("DescribeAggrSoftDeviceList", req, cb);
    }
    /**
     * 创建终端导出任务，私有化调用path为：capi/Assets/Device/ExportDeviceDownloadTask
     */
    async ExportDeviceDownloadTask(req, cb) {
        return this.request("ExportDeviceDownloadTask", req, cb);
    }
    /**
     * 创建获取终端进程网络服务信息任务，私有化调用path为：capi/Assets/Device/DescribeDeviceInfo
     */
    async CreateDeviceTask(req, cb) {
        return this.request("CreateDeviceTask", req, cb);
    }
    /**
     * 查看指定终端的软件详情列表,私有化调用path为：capi/Software/DescribeSoftwareInformation
     */
    async DescribeSoftwareInformation(req, cb) {
        return this.request("DescribeSoftwareInformation", req, cb);
    }
    /**
     * 创建文件鉴定任务，私有化调用path为：capi/DlpOpenApi/CreateDLPFileDetectTask
     */
    async CreateDLPFileDetectTask(req, cb) {
        return this.request("CreateDLPFileDetectTask", req, cb);
    }
    /**
     * 创建终端自定义分组，私有化调用path为：/capi/Assets/Device/CreateDeviceVirtualGroup
     */
    async CreateDeviceVirtualGroup(req, cb) {
        return this.request("CreateDeviceVirtualGroup", req, cb);
    }
    /**
     * 查询文件鉴定任务结果
     */
    async DescribeDLPFileDetectTaskResult(req, cb) {
        return this.request("DescribeDLPFileDetectTaskResult", req, cb);
    }
    /**
     * 展示自定义分组终端列表，私有化调用path为：/capi/Assets/DescribeVirtualDevices
     */
    async DescribeVirtualDevices(req, cb) {
        return this.request("DescribeVirtualDevices", req, cb);
    }
    /**
     * 导出基于指定终端查看软件信息详情列表查询,私有化调用path为：capi/Software/ExportSoftwareInformationList
     */
    async ExportSoftwareInformationList(req, cb) {
        return this.request("ExportSoftwareInformationList", req, cb);
    }
    /**
     * 提交送检任务
     */
    async CreateDLPFileDetectionTask(req, cb) {
        return this.request("CreateDLPFileDetectionTask", req, cb);
    }
    /**
     * 生成特权码，私有化调用path为：capi/Assets/Device/CreatePrivilegeCode，生成的特权码、卸载码，仅对该设备当天有效
     */
    async CreatePrivilegeCode(req, cb) {
        return this.request("CreatePrivilegeCode", req, cb);
    }
    /**
     * 查询账号根分组详情。对应“用户与授权管理”里内置不可见的全网根账号组，所有新建的目录，都挂在该全网根账号组下。
     */
    async DescribeRootAccountGroup(req, cb) {
        return this.request("DescribeRootAccountGroup", req, cb);
    }
    /**
     * webservice查询文件检测结果
     */
    async DescribeDLPFileDetectResult(req, cb) {
        return this.request("DescribeDLPFileDetectResult", req, cb);
    }
    /**
     * 聚合的分类软件列表
     */
    async DescribeAggrSoftCategorySoftList(req, cb) {
        return this.request("DescribeAggrSoftCategorySoftList", req, cb);
    }
    /**
     * 查询边缘节点列表，私有化调用path为：capi/DlpOpenApi/DescribeDLPEdgeNodes
     */
    async DescribeDLPEdgeNodes(req, cb) {
        return this.request("DescribeDLPEdgeNodes", req, cb);
    }
    /**
     * 聚合的软件详情
     */
    async DescribeAggrSoftDetail(req, cb) {
        return this.request("DescribeAggrSoftDetail", req, cb);
    }
    /**
     * 获取终端进程网络服务信息，私有化调用path为：capi/Assets/Device/DescribeDeviceInfo
     */
    async DescribeDeviceInfo(req, cb) {
        return this.request("DescribeDeviceInfo", req, cb);
    }
    /**
     * 查询满足条件的查询终端硬件信息列表，私有化调用path为：/capi/Assets/Device/DescribeDeviceHardwareInfoList
     */
    async DescribeDeviceHardwareInfoList(req, cb) {
        return this.request("DescribeDeviceHardwareInfoList", req, cb);
    }
    /**
     * 查询设备组子分组详情，私有化调用path为：capi/Assets/Device/DescribeDeviceChildGroups
     */
    async DescribeDeviceChildGroups(req, cb) {
        return this.request("DescribeDeviceChildGroups", req, cb);
    }
    /**
     * 以分页的方式查询账号分组列表，私有化调用path为：/capi/Assets/DescribeAccountGroups
     */
    async DescribeAccountGroups(req, cb) {
        return this.request("DescribeAccountGroups", req, cb);
    }
    /**
     * 基于软件查看终端详情列表,私有化调用path为：capi/Software/DescribeDeviceDetailList
     */
    async DescribeDeviceDetailList(req, cb) {
        return this.request("DescribeDeviceDetailList", req, cb);
    }
    /**
     * 获取账号列表，支持分页，模糊搜索，私有化调用path为：/capi/Assets/Account/DescribeLocalAccounts
     */
    async DescribeLocalAccounts(req, cb) {
        return this.request("DescribeLocalAccounts", req, cb);
    }
    /**
     * 查询边缘节点分组，私有化调用path为：capi/Connectors/DescribeDLPEdgeNodeGroups
     */
    async DescribeDLPEdgeNodeGroups(req, cb) {
        return this.request("DescribeDLPEdgeNodeGroups", req, cb);
    }
    /**
     * 查询满足条件的终端数据详情，私有化调用path为：/capi/Assets/Device/DescribeDevices
     */
    async DescribeDevices(req, cb) {
        return this.request("DescribeDevices", req, cb);
    }
    /**
     * 查询终端自定义分组列表，私有化调用path为：/capi/Assets/Device/DescribeDeviceVirtualGroups
     */
    async DescribeDeviceVirtualGroups(req, cb) {
        return this.request("DescribeDeviceVirtualGroups", req, cb);
    }
    /**
     * 查看终端树下的软件列表,私有化调用path为：capi/Software/DescribeSoftCensusListByDevice
     */
    async DescribeSoftCensusListByDevice(req, cb) {
        return this.request("DescribeSoftCensusListByDevice", req, cb);
    }
    /**
     * 终端自定义分组增减终端，私有化调用path为：/capi/Assets/Device/ModifyVirtualDeviceGroups
     */
    async ModifyVirtualDeviceGroups(req, cb) {
        return this.request("ModifyVirtualDeviceGroups", req, cb);
    }
}
exports.Client = Client;
