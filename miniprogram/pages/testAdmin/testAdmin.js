// pages/testAdmin/testAdmin.js
Page({
  data: {
    isBound: false,
    isAdmin: false,
    userInfo: null
  },

  onShow: function() {
    this.checkUserStatus();
  },

  checkUserStatus: function() {
    const that = this;
    wx.showLoading({
      title: '检查中...'
    });

    wx.cloud.callFunction({
      name: 'getUserStatus',
      success: res => {
        wx.hideLoading();
        const result = res.result;
        that.setData({
          isBound: result.isBound,
          isAdmin: result.isAdmin,
          userInfo: result.userInfo
        });
      },
      fail: err => {
        wx.hideLoading();
        console.error('检查失败', err);
        wx.showToast({
          title: '检查失败',
          icon: 'none'
        });
      }
    });
  },

  goBind: function() {
    wx.navigateTo({
      url: '/pages/login/login'
    });
  },

  checkAdmin: function() {
    wx.showToast({
      title: '请确保手机号在admins集合中',
      icon: 'none'
    });
    this.checkUserStatus();
  },

  goAdmin: function() {
    wx.navigateTo({
      url: '/pages/admin/admin'
    });
  }
});