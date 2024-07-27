const {PlayerScheduleResolver} = require("../schedule");
const moment = require("moment");

test('Returns URL with one simple schedule at 09:00', () => {
    const fakeTime = moment()
        .set('hour', 9)
        .set('minute', 0)
        .set('second', 0)
        .valueOf();

    jest.useFakeTimers();
    jest.setSystemTime(fakeTime);

    const schedules = [
        {
            start_time: "08:00",
            end_time: "20:00",
            days: "[1,2,3,4,5,6,0]",
            url: "http://example.com"
        }
    ];

    const url = PlayerScheduleResolver.get(schedules);

    expect(url).toBe("http://example.com");
})

test('Does not return URL with one simple schedule at 01:00', () => {
    const fakeTime = moment()
        .set('hour', 1)
        .set('minute', 0)
        .set('second', 0)
        .valueOf();

    jest.useFakeTimers();
    jest.setSystemTime(fakeTime);

    const schedules = [
        {
            start_time: "08:00",
            end_time: "20:00",
            days: "[1,2,3,4,5,6,0]",
            url: "http://example.com"
        }
    ];

    const url = PlayerScheduleResolver.get(schedules);

    expect(url).toBe("");
})

test('Returns URL with overnight schedule', () => {
    const fakeTime = moment()
        .set('hour', 1)
        .set('minute', 0)
        .set('second', 0)
        .valueOf();

    jest.useFakeTimers();
    jest.setSystemTime(fakeTime);

    const schedules = [
        {
            start_time: "08:00",
            end_time: "02:00",
            days: "[1,2,3,4,5,6,0]",
            url: "http://example.com"
        }
    ];

    const url = PlayerScheduleResolver.get(schedules);

    expect(url).toBe("http://example.com");
})

test('Does not return URL with overnight schedule', () => {
    const fakeTime = moment()
        .set('hour', 3)
        .set('minute', 0)
        .set('second', 0)
        .valueOf();

    jest.useFakeTimers();
    jest.setSystemTime(fakeTime);

    const schedules = [
        {
            start_time: "08:00",
            end_time: "02:00",
            days: "[1,2,3,4,5,6,0]",
            url: "http://example.com"
        }
    ];

    const url = PlayerScheduleResolver.get(schedules);

    expect(url).toBe("");
})
