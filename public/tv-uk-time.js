(function () {
  'use strict';

  function lastSunday(year, monthIndex) {
    var lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
    return lastDay.getUTCDate() - lastDay.getUTCDay();
  }

  function isBritishSummerTime(date) {
    var year = date.getUTCFullYear();
    var start = Date.UTC(year, 2, lastSunday(year, 2), 1, 0, 0);
    var end = Date.UTC(year, 9, lastSunday(year, 9), 1, 0, 0);
    var value = date.getTime();
    return value >= start && value < end;
  }

  function ukDate(date) {
    var source = date instanceof Date ? date : new Date(date);
    if (isNaN(source.getTime())) { return source; }
    return new Date(source.getTime() + (isBritishSummerTime(source) ? 60 * 60 * 1000 : 0));
  }

  window.SlhUkTime = {
    date: ukDate,
    isBst: isBritishSummerTime
  };
}());
