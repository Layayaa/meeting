// pages/index/index.js
Page({
  data: {
    remainingCount: 0,
    isBound: false,
    isAdmin: false,
    userStatus: 'inactive',
    userInfo: null,
    displayName: '用户',
    avatarText: '用',
    noticePreview: null,
    noticePreviewLoading: false,
    todayDisplay: '',
    todayRooms: [],
    todayFreeCount: 0,
    todayBusyCount: 0,
    contactInfo: {
      wechat: '',
      email: '',
      qrImage: '',
      subjectHint: '',
      visible: false
    },
    accountStatusText: '未登录',
    accountStatusClass: 'offline',
    dashboardLoading: false,
    dashboardStats: {
      weekRange: { start: '', end: '' },
      totalReservations: 0,
      roomUsage: [],
      activeUsers: [],
      peakSlots: [],
      topRoomText: '--',
      topSlotText: '--'
    },
    rooms: ['会议室A', '会议室B', '会议室C']
  },

  getDefaultContactInfo: function() {
    return {
      wechat: '',
      email: '3963632979@qq.com',
      qrImage: '/images/contact/oacend-wechat.jpg',
      subjectHint: '项目名称+联系人姓名+电话',
      visible: true
    };
  },

  onLoad: function() {
    this.initTodayDisplay();
    this.loadNoticePreview();
    this.loadRoomSettings();
    this.checkUserStatus();
  },

  onShow: function() {
    this.initTodayDisplay();
    this.loadNoticePreview();
    this.loadRoomSettings();
    this.checkUserStatus();
  },

  formatPreviewTime(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      const str = String(value);
      return str.length > 16 ? str.slice(0, 16) : str;
    }
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  },

  loadNoticePreview: function() {
    this.setData({
      noticePreviewLoading: true
    });
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getNotices',
        scope: 'user'
      },
      success: (res) => {
        const result = (res && res.result) || {};
        const list = Array.isArray(result.notices) ? result.notices : [];
        const first = list[0];
        if (!first) {
          this.setData({
            noticePreview: null,
            noticePreviewLoading: false
          });
          return;
        }
        const content = String(first.content || '').replace(/\s+/g, ' ').trim();
        this.setData({
          noticePreview: {
            _id: first._id,
            title: first.title || '通知公告',
            contentPreview: content.length > 52 ? `${content.slice(0, 52)}...` : content,
            is_pinned: !!first.is_pinned,
            timeText: this.formatPreviewTime(first.published_at || first.created_at)
          },
          noticePreviewLoading: false
        });
      },
      fail: (err) => {
        console.error('加载通知预览失败', err);
        this.setData({
          noticePreview: null,
          noticePreviewLoading: false
        });
      }
    });
  },

  loadRoomSettings: function() {
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getSettings' },
      success: (res) => {
        const settings = res.result && res.result.settings;
        const rooms = (settings && Array.isArray(settings.room_names) && settings.room_names.length)
          ? settings.room_names
          : ['会议室A', '会议室B', '会议室C'];
        const defaults = this.getDefaultContactInfo();
        const contactWechat = String((settings && settings.contact_wechat) || defaults.wechat).trim();
        const contactEmail = String((settings && settings.contact_email) || defaults.email).trim();
        const contactQrImage = String((settings && settings.contact_qr_image) || defaults.qrImage).trim();
        const contactSubjectHint = String((settings && settings.contact_subject_hint) || defaults.subjectHint).trim();
        this.setData({
          rooms,
          contactInfo: {
            wechat: contactWechat,
            email: contactEmail,
            qrImage: contactQrImage,
            subjectHint: contactSubjectHint,
            visible: !!(contactWechat || contactEmail || contactQrImage)
          }
        }, () => {
          this.loadTodayRooms();
        });
      },
      fail: () => {
        this.setData({
          rooms: ['会议室A', '会议室B', '会议室C'],
          contactInfo: this.getDefaultContactInfo()
        }, () => {
          this.loadTodayRooms();
        });
      }
    });
  },

  copyContact: function(e) {
    const value = String(e.currentTarget.dataset.value || '').trim();
    if (!value) return;
    wx.setClipboardData({
      data: value,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  saveContactQr: function(e) {
    const src = String(e.currentTarget.dataset.src || '').trim();
    if (!src) return;
    wx.getImageInfo({
      src,
      success: (info) => {
        wx.saveImageToPhotosAlbum({
          filePath: info.path,
          success: () => {
            wx.showToast({ title: '已保存', icon: 'success' });
          },
          fail: (err) => {
            const message = String((err && err.errMsg) || '');
            if (message.includes('auth deny') || message.includes('authorize no response')) {
              wx.showModal({
                title: '需要授权',
                content: '请允许保存到相册后，再次点击二维码保存。',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) wx.openSetting();
                }
              });
              return;
            }
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '二维码加载失败', icon: 'none' });
      }
    });
  },

  initTodayDisplay: function() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    this.setData({ todayDisplay: `${month}月${day}日 周${weekDay}` });
  },

  updateAccountStatus: function(isBound, userStatus) {
    let accountStatusText = '未登录';
    let accountStatusClass = 'offline';
    if (isBound && userStatus === 'active') {
      accountStatusText = '可预约';
      accountStatusClass = 'normal';
    } else if (isBound && userStatus === 'disabled') {
      accountStatusText = '已禁用';
      accountStatusClass = 'disabled';
    } else if (isBound) {
      accountStatusText = '待启用';
      accountStatusClass = 'pending';
    }
    this.setData({ accountStatusText, accountStatusClass });
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
          avatarText: userInfo && userInfo.name ? String(userInfo.name).slice(0, 1) : '用',
          remainingCount: Number(result.remainingCount) || 0
        }, () => {
          that.updateAccountStatus(that.data.isBound, that.data.userStatus);
          if (that.data.isAdmin) {
            that.loadDashboardStats();
          }
        });
      },
      fail: err => {
        console.error('获取用户状态失败', err);
        that.setData({
          isBound: false,
          isAdmin: false,
          userStatus: 'inactive',
          userInfo: null,
          displayName: '用户',
          avatarText: '用',
          remainingCount: 0
        }, () => {
          that.updateAccountStatus(false, 'inactive');
        });
      }
    });
  },

  loadTodayRooms: function() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    const rooms = this.data.rooms && this.data.rooms.length
      ? this.data.rooms
      : ['会议室A', '会议室B', '会议室C'];
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
        const todayFreeCount = todayRooms.filter(item => item.isFree).length;
        this.setData({
          todayRooms,
          todayFreeCount,
          todayBusyCount: Math.max(0, todayRooms.length - todayFreeCount)
        });
      },
      fail: () => {
        const todayRooms = rooms.map(room => ({ room, isFree: true, statusText: '' }));
        this.setData({
          todayRooms,
          todayFreeCount: todayRooms.length,
          todayBusyCount: 0
        });
      }
    });
  },

  loadDashboardStats: function() {
    this.setData({ dashboardLoading: true });
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getDashboardStats' },
      success: (res) => {
        const result = res.result || {};
        if (result.success && result.stats) {
          this.setData({
            dashboardStats: result.stats,
            dashboardLoading: false
          });
          return;
        }
        this.setData({ dashboardLoading: false });
      },
      fail: (err) => {
        console.error('loadDashboardStats failed', err);
        this.setData({ dashboardLoading: false });
      }
    });
  },

  goLogin: function() {
    wx.navigateTo({ url: '/pages/login/login' });
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

  goNotices: function() {
    wx.navigateTo({ url: '/pages/notices/notices' });
  },

  openNoticePreview: function() {
    const item = this.data.noticePreview;
    if (item && item._id) {
      wx.navigateTo({
        url: `/pages/noticeDetail/noticeDetail?id=${item._id}`
      });
      return;
    }
    this.goNotices();
  },

  goAdmin: function() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  goBind: function() {}
});
