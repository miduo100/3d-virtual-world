import { AbstractClient } from "../../../common/abstract_client";
export class Client extends AbstractClient {
    constructor(clientConfig) {
        super("cbs.tencentcloudapi.com", "2017-03-12", clientConfig);
    }
    async ModifyDiskExtraPerformance(req, cb) {
        return this.request("ModifyDiskExtraPerformance", req, cb);
    }
    async RenewDisk(req, cb) {
        return this.request("RenewDisk", req, cb);
    }
    async ApplyDiskBackup(req, cb) {
        return this.request("ApplyDiskBackup", req, cb);
    }
    async CopySnapshotCrossRegions(req, cb) {
        return this.request("CopySnapshotCrossRegions", req, cb);
    }
    async DescribeInstancesDiskNum(req, cb) {
        return this.request("DescribeInstancesDiskNum", req, cb);
    }
    async InquiryPriceResizeDisk(req, cb) {
        return this.request("InquiryPriceResizeDisk", req, cb);
    }
    async InquirePriceModifyDiskExtraPerformance(req, cb) {
        return this.request("InquirePriceModifyDiskExtraPerformance", req, cb);
    }
    async DescribeAutoSnapshotPolicies(req, cb) {
        return this.request("DescribeAutoSnapshotPolicies", req, cb);
    }
    async AttachDisks(req, cb) {
        return this.request("AttachDisks", req, cb);
    }
    async ModifyDisksRenewFlag(req, cb) {
        return this.request("ModifyDisksRenewFlag", req, cb);
    }
    async CreateSnapshotGroup(req, cb) {
        return this.request("CreateSnapshotGroup", req, cb);
    }
    async DeleteSnapshotGroup(req, cb) {
        return this.request("DeleteSnapshotGroup", req, cb);
    }
    async DeleteDiskBackups(req, cb) {
        return this.request("DeleteDiskBackups", req, cb);
    }
    async ModifyAutoSnapshotPolicyAttribute(req, cb) {
        return this.request("ModifyAutoSnapshotPolicyAttribute", req, cb);
    }
    async InquiryPriceCreateDisks(req, cb) {
        return this.request("InquiryPriceCreateDisks", req, cb);
    }
    async DescribeDiskBackups(req, cb) {
        return this.request("DescribeDiskBackups", req, cb);
    }
    async ApplySnapshotGroup(req, cb) {
        return this.request("ApplySnapshotGroup", req, cb);
    }
    async DeleteAutoSnapshotPolicies(req, cb) {
        return this.request("DeleteAutoSnapshotPolicies", req, cb);
    }
    async InitializeDisks(req, cb) {
        return this.request("InitializeDisks", req, cb);
    }
    async DescribeDisks(req, cb) {
        return this.request("DescribeDisks", req, cb);
    }
    async DescribeSnapshotGroups(req, cb) {
        return this.request("DescribeSnapshotGroups", req, cb);
    }
    async ModifyDiskBackupQuota(req, cb) {
        return this.request("ModifyDiskBackupQuota", req, cb);
    }
    async CreateDisks(req, cb) {
        return this.request("CreateDisks", req, cb);
    }
    async CopyAutoSnapshotPolicyCrossAccount(req, cb) {
        return this.request("CopyAutoSnapshotPolicyCrossAccount", req, cb);
    }
    async ModifyDiskAttributes(req, cb) {
        return this.request("ModifyDiskAttributes", req, cb);
    }
    async DeleteSnapshots(req, cb) {
        return this.request("DeleteSnapshots", req, cb);
    }
    async ModifySnapshotAttribute(req, cb) {
        return this.request("ModifySnapshotAttribute", req, cb);
    }
    async DescribeDiskAssociatedAutoSnapshotPolicy(req, cb) {
        return this.request("DescribeDiskAssociatedAutoSnapshotPolicy", req, cb);
    }
    async BindAutoSnapshotPolicy(req, cb) {
        return this.request("BindAutoSnapshotPolicy", req, cb);
    }
    async DescribeSnapshots(req, cb) {
        return this.request("DescribeSnapshots", req, cb);
    }
    async DescribeSnapshotSharePermission(req, cb) {
        return this.request("DescribeSnapshotSharePermission", req, cb);
    }
    async CreateAutoSnapshotPolicy(req, cb) {
        return this.request("CreateAutoSnapshotPolicy", req, cb);
    }
    async ModifyDisksChargeType(req, cb) {
        return this.request("ModifyDisksChargeType", req, cb);
    }
    async TerminateDisks(req, cb) {
        return this.request("TerminateDisks", req, cb);
    }
    async DescribeDiskConfigQuota(req, cb) {
        return this.request("DescribeDiskConfigQuota", req, cb);
    }
    async UnbindAutoSnapshotPolicy(req, cb) {
        return this.request("UnbindAutoSnapshotPolicy", req, cb);
    }
    async CreateDiskBackup(req, cb) {
        return this.request("CreateDiskBackup", req, cb);
    }
    async DescribeDiskStoragePool(req, cb) {
        return this.request("DescribeDiskStoragePool", req, cb);
    }
    async ApplySnapshot(req, cb) {
        return this.request("ApplySnapshot", req, cb);
    }
    async InquirePriceModifyDiskBackupQuota(req, cb) {
        return this.request("InquirePriceModifyDiskBackupQuota", req, cb);
    }
    async ModifySnapshotsSharePermission(req, cb) {
        return this.request("ModifySnapshotsSharePermission", req, cb);
    }
    async DescribeSnapshotOverview(req, cb) {
        return this.request("DescribeSnapshotOverview", req, cb);
    }
    async DetachDisks(req, cb) {
        return this.request("DetachDisks", req, cb);
    }
    async GetSnapOverview(req, cb) {
        return this.request("GetSnapOverview", req, cb);
    }
    async ResizeDisk(req, cb) {
        return this.request("ResizeDisk", req, cb);
    }
    async CreateSnapshot(req, cb) {
        return this.request("CreateSnapshot", req, cb);
    }
    async InquiryPriceRenewDisks(req, cb) {
        return this.request("InquiryPriceRenewDisks", req, cb);
    }
}
