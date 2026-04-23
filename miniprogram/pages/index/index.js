// pages/index/index.js
Page({
  data: {
    remainingCount: 0,
    isBound: false,
    isAdmin: false,
    userStatus: 'inactive',
    userInfo: null,
    displayName: '用户',
    todayDisplay: '',
    todayRooms: []
  },

  onLoad: function() {
    this.initTodayDisplay();
    this.checkUserStatus();
  },

  onShow: function() {
    this.initTodayDisplay();
    this.checkUserStatus();
  },

  initTodayDisplay: function() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    this.setData({ todayDisplay: `${month}月${day}日 周${weekDay}` });
  },

  checkUserStatus: function() {
    const that = this;
    wx.cloud.callFunction({
      name: 'getUserStatus',
      success: res => {
        const result = res.result || {};
        const userInfo = result.userInfo || null;
        that.setData({
          isBound: !!result.isBound,
          isAdmin: !!result.isAdmin,
          userStatus: result.userStatus || 'inactive',
          userInfo,
          displayName: userInfo && userInfo.name ? userInfo.name : '用户',
          remainingCount: Number(result.remainingCount) || 0
        });
        that.loadTodayRooms();
      },
      fail: err => {
        console.error('获取用户状态失败', err);
        that.setData({
          isBound: false,
          isAdmin: false,
          userStatus: 'inactive',
          userInfo: null,
          displayName: '用户',
          remainingCount: 0
        });
        that.loadTodayRooms();
      }
    });
  },

  loadTodayRooms: function() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    const rooms = ['会议室A', '会议室B', '会议室C'];
    wx.cloud.callFunction({
      name: 'getReservationsByDate',
      data: { date: today },
      success: res => {
        const reservations = (res.result && res.result.reservations) || [];
        const todayRooms = rooms.map(room => {
          const pending = reservations.filter(r => r.room === room && r.status === 'pending');
          const isFree = pending.length === 0;
          const statusText = isFree ? '' : `已约 ${pending.length} 段`;
          return { room, isFree, statusText };
        });
        this.setData({ todayRooms });
      },
      fail: () => {
        this.setData({
          todayRooms: rooms.map(room => ({ room, isFree: true, statusText: '' }))
        });
      }
    });
  },

  goReserve: function() {
    if (!this.data.isBound || this.data.userStatus === 'disabled') {
      wx.showToast({ title: !this.data.isBound ? '请先登录' : '账户已被禁用', icon: 'none' });
      return;
    }
    wx.switchTab({ url: '/pages/reserve/reserve' });
  },

  goReserveWithRoom: function(e) {
    wx.switchTab({ url: '/pages/reserve/reserve' });
  },

  goMyReservations: function() {
    wx.switchTab({ url: '/pages/myReservations/myReservations' });
  },

  goActivities: function() {
    wx.switchTab({ url: '/pages/activities/activities' });
  },

  goAdmin: function() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  goBind: function() {}
});
