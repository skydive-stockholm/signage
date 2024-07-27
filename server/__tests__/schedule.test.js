const { PlayerScheduleResolver } = require("../PlayerScheduleResolver.js");
const moment = require("moment");

describe('PlayerScheduleResolver', () => {
    beforeAll(() => {
        jest.useFakeTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    const setTestTime = (hour, minute = 0, second = 0, day = 1) => {
        const fakeTime = moment().set({ hour, minute, second, day }).valueOf();
        jest.setSystemTime(fakeTime);
    };

    const createSchedule = (start_time, end_time, days, url) => ({
        start_time,
        end_time,
        days: JSON.stringify(days),
        url
    });

    const testScheduleResolver = (time, schedules, expected) => {
        setTestTime(time.hour, time.minute, time.second, time.day);
        const url = PlayerScheduleResolver.get(schedules);
        expect(url).toBe(expected);
    };

    describe('Simple schedule tests', () => {
        const simpleSchedule = [createSchedule("08:00", "20:00", [1,2,3,4,5,6,0], "http://example.com")];

        test('Returns URL at 09:00', () => {
            testScheduleResolver({ hour: 9 }, simpleSchedule, "http://example.com");
        });

        test('Does not return URL at 01:00', () => {
            testScheduleResolver({ hour: 1 }, simpleSchedule, "");
        });
    });

    describe('Overnight schedule tests', () => {
        const overnightSchedule = [createSchedule("08:00", "02:00", [1,2,3,4,5,6,0], "http://example.com")];

        test('Returns URL at 01:00', () => {
            testScheduleResolver({ hour: 1 }, overnightSchedule, "http://example.com");
        });

        test('Does not return URL at 03:00', () => {
            testScheduleResolver({ hour: 3 }, overnightSchedule, "");
        });
    });

    describe('Midnight schedule test', () => {
        const midnightSchedule = [createSchedule("18:00", "00:00", [1,2,3,4,5,6,0], "http://example.com")];

        test('Returns URL at 18:30', () => {
            testScheduleResolver({ hour: 18, minute: 30 }, midnightSchedule, "http://example.com");
        });
    });

    describe('Multiple schedules tests', () => {
        const multipleSchedules = [
            createSchedule("13:00", "15:00", [1,2,3,4,5,6,0], "http://example.org"),
            createSchedule("08:00", "20:00", [1,2,3,4,5,6,0], "http://example.com")
        ];

        test('Returns first matching URL at 14:00', () => {
            testScheduleResolver({ hour: 14, day: 2 }, multipleSchedules, "http://example.org");
        });

        test('Returns second matching URL at 16:00', () => {
            testScheduleResolver({ hour: 16, day: 2 }, multipleSchedules, "http://example.com");
        });
    });
});
