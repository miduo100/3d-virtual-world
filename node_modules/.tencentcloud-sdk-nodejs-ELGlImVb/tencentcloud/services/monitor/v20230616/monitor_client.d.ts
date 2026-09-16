import { AbstractClient } from "../../../common/abstract_client";
import { ClientConfig } from "../../../common/interface";
import { DescribeAlarmNotifyHistoriesRequest, DeleteNoticeContentTmplsRequest, DescribeAIWorkbenchSREDigitalTwinTaskListRequest, CreateNoticeContentTmplResponse, TriggerAIWorkbenchSREDigitalTwinTaskRequest, TriggerAIWorkbenchSREDigitalTwinTaskResponse, DescribeAIWorkbenchSREDigitalTwinWorkLogListResponse, ModifyNoticeContentTmplResponse, DescribeNoticeContentTmplResponse, DescribeAIWorkbenchSREDigitalTwinWorkLogDetailRequest, DescribeAlarmNotifyHistoriesResponse, DescribeAIWorkbenchSREDigitalTwinTaskListResponse, DeleteNoticeContentTmplsResponse, DescribeNoticeContentTmplRequest, ModifyNoticeContentTmplRequest, CreateNoticeContentTmplRequest, DescribeAIWorkbenchSREDigitalTwinWorkLogListRequest, DescribeAIWorkbenchSREDigitalTwinWorkLogDetailResponse } from "./monitor_models";
/**
 * monitor client
 * @class
 */
export declare class Client extends AbstractClient {
    constructor(clientConfig: ClientConfig);
    /**
     * 删除通知内容模板
     */
    DeleteNoticeContentTmpls(req: DeleteNoticeContentTmplsRequest, cb?: (error: string, rep: DeleteNoticeContentTmplsResponse) => void): Promise<DeleteNoticeContentTmplsResponse>;
    /**
     * 根据查询条件获取自定义通知内容模板，若所有查询条件空，则获取账号下所有模板
     */
    DescribeNoticeContentTmpl(req: DescribeNoticeContentTmplRequest, cb?: (error: string, rep: DescribeNoticeContentTmplResponse) => void): Promise<DescribeNoticeContentTmplResponse>;
    /**
     * 查询AI工作台SRE数字分身工作日志详细信息
     */
    DescribeAIWorkbenchSREDigitalTwinWorkLogDetail(req: DescribeAIWorkbenchSREDigitalTwinWorkLogDetailRequest, cb?: (error: string, rep: DescribeAIWorkbenchSREDigitalTwinWorkLogDetailResponse) => void): Promise<DescribeAIWorkbenchSREDigitalTwinWorkLogDetailResponse>;
    /**
     * 创建自定义通知内容模板
     */
    CreateNoticeContentTmpl(req: CreateNoticeContentTmplRequest, cb?: (error: string, rep: CreateNoticeContentTmplResponse) => void): Promise<CreateNoticeContentTmplResponse>;
    /**
     * 触发数字分身任务请求
     */
    TriggerAIWorkbenchSREDigitalTwinTask(req: TriggerAIWorkbenchSREDigitalTwinTaskRequest, cb?: (error: string, rep: TriggerAIWorkbenchSREDigitalTwinTaskResponse) => void): Promise<TriggerAIWorkbenchSREDigitalTwinTaskResponse>;
    /**
     * 修改通知内容模板
     */
    ModifyNoticeContentTmpl(req: ModifyNoticeContentTmplRequest, cb?: (error: string, rep: ModifyNoticeContentTmplResponse) => void): Promise<ModifyNoticeContentTmplResponse>;
    /**
     * 查询AI工作台SRE数字分身任务工作日志列表
     */
    DescribeAIWorkbenchSREDigitalTwinWorkLogList(req: DescribeAIWorkbenchSREDigitalTwinWorkLogListRequest, cb?: (error: string, rep: DescribeAIWorkbenchSREDigitalTwinWorkLogListResponse) => void): Promise<DescribeAIWorkbenchSREDigitalTwinWorkLogListResponse>;
    /**
     * 按需查询告警的通知历史
     */
    DescribeAlarmNotifyHistories(req: DescribeAlarmNotifyHistoriesRequest, cb?: (error: string, rep: DescribeAlarmNotifyHistoriesResponse) => void): Promise<DescribeAlarmNotifyHistoriesResponse>;
    /**
     * 查询AI工作台SRE数字分身任务列表
     */
    DescribeAIWorkbenchSREDigitalTwinTaskList(req: DescribeAIWorkbenchSREDigitalTwinTaskListRequest, cb?: (error: string, rep: DescribeAIWorkbenchSREDigitalTwinTaskListResponse) => void): Promise<DescribeAIWorkbenchSREDigitalTwinTaskListResponse>;
}
