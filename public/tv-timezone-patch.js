(function () {
  'use strict';

  function lastSunday(year, monthIndex) {
    var lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
    return lastDay.getUTCDate() - lastDay.getUTCDay();
  }

  function bstOffsetMs(date) {
    var year = date.getUTCFullYear();
    var start = Date.UTC(year, 2, lastSunday(year, 2), 1, 0, 0);
    var end = Date.UTC(year, 9, lastSunday(year, 9), 1, 0, 0);
    var value = date.getTime();
    return value >= start && value < end ? 3600000 : 0;
  }

  function ukView(date) {
    return new Date(date.getTime() + bstOffsetMs(date));
  }

  var nativeGetHours = Date.prototype.getHours;
  var nativeGetMinutes = Date.prototype.getMinutes;
  var nativeGetDate = Date.prototype.getDate;
  var nativeGetDay = Date.prototype.getDay;
  var nativeGetMonth = Date.prototype.getMonth;
  var nativeGetFullYear = Date.prototype.getFullYear;

  Date.prototype.getHours = function () { return ukView(this).getUTCHours(); };
  Date.prototype.getMinutes = function () { return ukView(this).getUTCMinutes(); };
  Date.prototype.getDate = function () { return ukView(this).getUTCDate(); };
  Date.prototype.getDay = function () { return ukView(this).getUTCDay(); };
  Date.prototype.getMonth = function () { return ukView(this).getUTCMonth(); };
  Date.prototype.getFullYear = function () { return ukView(this).getUTCFullYear(); };

  window.SlhTvNativeDateGetters = {
    getHours: nativeGetHours,
    getMinutes: nativeGetMinutes,
    getDate: nativeGetDate,
    getDay: nativeGetDay,
    getMonth: nativeGetMonth,
    getFullYear: nativeGetFullYear
  };
}());
