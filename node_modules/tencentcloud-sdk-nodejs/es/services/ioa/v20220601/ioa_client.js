import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("ioa.tencentcloudapi.com", "2022-06-01", clientConfig);
    }
    async DescribeAggrSoftDeviceList(req, cb) {
        return this.request("DescribeAggrSoftDeviceList", req, cb);
    }
    async ExportDeviceDownloadTask(req, cb) {
        return this.request("ExportDeviceDownloadTask", req, cb);
    }
    async CreateDeviceTask(req, cb) {
        return this.request("CreateDeviceTask", req, cb);
    }
    async DescribeSoftwareInformation(req, cb) {
        return this.request("DescribeSoftwareInformation", req, cb);
    }
    async CreateDLPFileDetectTask(req, cb) {
        return this.request("CreateDLPFileDetectTask", req, cb);
    }
    async CreateDeviceVirtualGroup(req, cb) {
        return this.request("CreateDeviceVirtualGroup", req, cb);
    }
    async DescribeDLPFileDetectTaskResult(req, cb) {
        return this.request("DescribeDLPFileDetectTaskResult", req, cb);
    }
    async DescribeVirtualDevices(req, cb) {
        return this.request("DescribeVirtualDevices", req, cb);
    }
    async ExportSoftwareInformationList(req, cb) {
        return this.request("ExportSoftwareInformationList", req, cb);
    }
    async CreateDLPFileDetectionTask(req, cb) {
        return this.request("CreateDLPFileDetectionTask", req, cb);
    }
    async CreatePrivilegeCode(req, cb) {
        return this.request("CreatePrivilegeCode", req, cb);
    }
    async DescribeRootAccountGroup(req, cb) {
        return this.request("DescribeRootAccountGroup", req, cb);
    }
    async DescribeDLPFileDetectResult(req, cb) {
        return this.request("DescribeDLPFileDetectResult", req, cb);
    }
    async DescribeAggrSoftCategorySoftList(req, cb) {
        return this.request("DescribeAggrSoftCategorySoftList", req, cb);
    }
    async DescribeDLPEdgeNodes(req, cb) {
        return this.request("DescribeDLPEdgeNodes", req, cb);
    }
    async DescribeAggrSoftDetail(req, cb) {
        return this.request("DescribeAggrSoftDetail", req, cb);
    }
    async DescribeDeviceInfo(req, cb) {
        return this.request("DescribeDeviceInfo", req, cb);
    }
    async DescribeDeviceHardwareInfoList(req, cb) {
        return this.request("DescribeDeviceHardwareInfoList", req, cb);
    }
    async DescribeDeviceChildGroups(req, cb) {
        return this.request("DescribeDeviceChildGroups", req, cb);
    }
    async DescribeAccountGroups(req, cb) {
        return this.request("DescribeAccountGroups", req, cb);
    }
    async DescribeDeviceDetailList(req, cb) {
        return this.request("DescribeDeviceDetailList", req, cb);
    }
    async DescribeLocalAccounts(req, cb) {
        return this.request("DescribeLocalAccounts", req, cb);
    }
    async DescribeDLPEdgeNodeGroups(req, cb) {
        return this.request("DescribeDLPEdgeNodeGroups", req, cb);
    }
    async DescribeDevices(req, cb) {
        return this.request("DescribeDevices", req, cb);
    }
    async DescribeDeviceVirtualGroups(req, cb) {
        return this.request("DescribeDeviceVirtualGroups", req, cb);
    }
    async DescribeSoftCensusListByDevice(req, cb) {
        return this.request("DescribeSoftCensusListByDevice", req, cb);
    }
    async ModifyVirtualDeviceGroups(req, cb) {
        return this.request("ModifyVirtualDeviceGroups", req, cb);
    }
}
