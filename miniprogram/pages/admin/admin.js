// pages/admin/admin.js
Page({
  data: {},

  goUserManage() {
    wx.navigateTo({ url: '/pages/userManage/userManage' })
  },

  goReservationManage() {
    wx.navigateTo({ url: '/pages/reservationManage/reservationManage' })
  },

  goActivityManage() {
    wx.navigateTo({ url: '/pages/activityManage/activityManage' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})