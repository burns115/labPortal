import axios, { AxiosResponse } from 'axios';
import { CreateErrorLog } from './errorLogService';
import { CreateAuditLog, AuditLogType } from './auditService';
import { getUserByToken } from './loginService';
import moment from 'moment-timezone';

interface FilteredLog {
    id: number;
    studentId: number;
    studentName: string;
    itemId?: number;
    itemDescription?: string;
    timeIn: string;
    timeOut?: string;
    monitorID: number;
}

interface LogCreate {
    studentId: number;
    timein: string;
    timeout: string;
    labId: number;
    monitorId: number;
    itemId?: number;
}

interface Checkin {
    summaryId: number;
    studentId: number;
    timein: string;
    timeout?: string;
    labId: number;
    monitorId: number;
    itemId?: number;
    isDeleted: boolean;
}

interface LogHistory {
    studentId: number;
    itemId?: number;
    timestamp: string;
    transactionType: string;
    labId: number;
    monitorId: number;
}

class LogService {
    private baseUrl: string;

    constructor() {
        this.baseUrl = `${process.env.EXPO_PUBLIC_API}/Logs`;
    }

    private convertToLocalTime(utcTime: string, timeZone: string = moment.tz.guess()): string {
        return moment.utc(utcTime).tz(timeZone).format('YYYY-MM-DD HH:mm:ss');
    }

    private convertToUTCTime(localTime: string, timeZone: string = moment.tz.guess()): string {
        return moment.tz(localTime, timeZone).utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
    }

    async getLogsByLab(labId: number, startDate?: string, endDate?: string): Promise<FilteredLog[]> {
        try {
            const params = { labId, startDate, endDate };
            const response: AxiosResponse<any> = await axios.get(`${this.baseUrl}/FilteredLogs/Lab`, { params });

            const logs = response.data.$values;

            return logs.map((log: any) => ({
                id: log.id,
                studentId: log.studentId,
                studentName: log.studentName,
                itemId: log.itemId,
                itemDescription: log.itemDescription,
                timeIn: this.convertToLocalTime(log.timeIn),
                timeOut: log.timeOut ? this.convertToLocalTime(log.timeOut) : undefined,
                monitorID: log.monitorID,
            }));
        } catch (error) {
            await this.handleError(error, 'getLogsByLab');
            throw error;
        }
    }

    async getLogsFilteredByDate(startDate?: string, endDate?: string): Promise<FilteredLog[]> {
        try {
            const params = { startDate, endDate };
            const response: AxiosResponse<FilteredLog[]> = await axios.get(`${this.baseUrl}/FilteredLogs`, { params });
            await this.audit('view', `Viewed logs from ${startDate} to ${endDate}`);
            return response.data.map(log => ({
                ...log,
                timeIn: this.convertToLocalTime(log.timeIn),
                timeOut: log.timeOut ? this.convertToLocalTime(log.timeOut) : undefined,
            }));
        } catch (error) {
            await this.handleError(error, 'getLogsFilteredByDate');
            throw error;
        }
    }

    async updateLog(id: number, log: LogCreate): Promise<void> {
        try {
            const updatedLog = {
                ...log,
                timein: this.convertToUTCTime(log.timein),
                timeout: log.timeout ? this.convertToUTCTime(log.timeout) : null,
            };
            await axios.put(`${this.baseUrl}/${id}`, updatedLog);
            await this.audit('update', `Updated log with ID: ${id}`, log.monitorId);
        } catch (error) {
            await this.handleError(error, 'updateLog');
            throw error;
        }
    }

    async createLog(log: LogCreate): Promise<Checkin> {
        try {
            const newLog = {
                ...log,
                timein: this.convertToUTCTime(log.timein),
                timeout: null,
            };
            const response: AxiosResponse<Checkin> = await axios.post(this.baseUrl, newLog);
            await this.audit('insert', `Created new log for student ID: ${log.studentId}`, log.monitorId);
            return response.data;
        } catch (error) {
            await this.handleError(error, 'createLog');
            throw error;
        }
    }

    async timeOutLog(id: number, monitorId: number): Promise<void> {
        try {
            const params = { monitor: monitorId };
            await axios.put(`${this.baseUrl}/TimeOut/${id}`, null, { params });
            await this.audit('update', `Timed out log with ID: ${id}`, monitorId);
        } catch (error) {
            await this.handleError(error, 'timeOutLog');
            throw error;
        }
    }

    async deleteLog(id: number, monitorId: number): Promise<void> {
        try {
            const params = { monitor: monitorId };
            await axios.delete(`${this.baseUrl}/${id}`, { params });
            await this.audit('delete', `Deleted log with ID: ${id}`, monitorId);
        } catch (error) {
            await this.handleError(error, 'deleteLog');
            throw error;
        }
    }

    async getLogHistory(summaryId: number): Promise<LogHistory[]> {
        try {
            const response: AxiosResponse<LogHistory[]> = await axios.get(`${this.baseUrl}/History/${summaryId}`);
            await this.audit('view', `Viewed log history for summary ID: ${summaryId}`);
            return response.data.map(log => ({
                ...log,
                timestamp: this.convertToLocalTime(log.timestamp),
            }));
        } catch (error) {
            await this.handleError(error, 'getLogHistory');
            throw error;
        }
    }

    async getLogById(summaryId: number): Promise<Checkin> {
        try {
            const response: AxiosResponse<Checkin> = await axios.get(`${this.baseUrl}/${summaryId}`);
            await this.audit('view', `Viewed log with summary ID: ${summaryId}`);
            const log = response.data;
            return {
                ...log,
                timein: this.convertToLocalTime(log.timein),
                timeout: log.timeout ? this.convertToLocalTime(log.timeout) : undefined,
            };
        } catch (error) {
            await this.handleError(error, 'getLogById');
            throw error;
        }
    }

    async getAllSummaries(): Promise<Checkin[]> {
        try {
            const response: AxiosResponse<Checkin[]> = await axios.get(this.baseUrl);
            await this.audit('view', `Viewed all log summaries`);
            return response.data.map(log => ({
                ...log,
                timein: this.convertToLocalTime(log.timein),
                timeout: log.timeout ? this.convertToLocalTime(log.timeout) : undefined,
            }));
        } catch (error) {
            await this.handleError(error, 'getAllSummaries');
            throw error;
        }
    }

    private async handleError(error: any, source: string): Promise<void> {
        await CreateErrorLog(error as Error, source, null, 'error');
    }

    private async audit(auditType: AuditLogType, description: string, userID?: number): Promise<void> {
        try {
            const user = await getUserByToken(); 
            const userId = userID || Number(user.userId); 
            await CreateAuditLog(description, userId, auditType);
        } catch (error) {
            console.error('Failed to create audit log:', error);
        }
    }
}

export default new LogService();
