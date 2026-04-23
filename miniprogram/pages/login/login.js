// pages/login/login.js
Page({
  data: {
    isReady: false,
    activeTab: 'login',
    loginForm: {
      phone: '',
      password: ''
    },
    registerForm: {
      phone: '',
      nickname: '',
      password: '',
      confirmPassword: ''
    },
    submitting: false
  },

  onLoad: function(options) {
    // 检查是否已绑定
    this.checkBindStatus();
  },

  checkBindStatus: function() {
    const that = this;
    wx.cloud.callFunction({
      name: 'checkBindStatus',
      success: res => {
        if (res.result.isBound) {
          // 已绑定，直接跳转首页
          wx.switchTab({
            url: '/pages/index/index'
          });
        } else {
          // 未绑定，显示绑定页面
          that.setData({ isReady: true });
        }
      },
      fail: err => {
        console.error('检查绑定状态失败', err);
        that.setData({ isReady: true });
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    });
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
  },

  bindLoginInput: function(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({
      [`loginForm.${key}`]: e.detail.value
    });
  },

  bindRegisterInput: function(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({
      [`registerForm.${key}`]: e.detail.value
    });
  },

  validateLoginForm: function() {
    const phone = String(this.data.loginForm.phone || '').trim();
    const password = String(this.data.loginForm.password || '');
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({
        title: '请输入正确的手机号',
        icon: 'none'
      });
      return false;
    }
    if (password.length < 6) {
      wx.showToast({
        title: '密码至少6位',
        icon: 'none'
      });
      return false;
    }
    return true;
  },

  validateRegisterForm: function() {
    const phone = String(this.data.registerForm.phone || '').trim();
    const nickname = String(this.data.registerForm.nickname || '').trim();
    const password = String(this.data.registerForm.password || '');
    const confirmPassword = String(this.data.registerForm.confirmPassword || '');
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({
        title: '请输入正确的手机号',
        icon: 'none'
      });
      return false;
    }
    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return false;
    }
    if (nickname.length > 20) {
      wx.showToast({
        title: '昵称最多20个字',
        icon: 'none'
      });
      return false;
    }
    if (password.length < 6) {
      wx.showToast({
        title: '密码至少6位',
        icon: 'none'
      });
      return false;
    }
    if (password !== confirmPassword) {
      wx.showToast({
        title: '两次密码不一致',
        icon: 'none'
      });
      return false;
    }
    return true;
  },

  bindPhone: function() {
    if (this.data.submitting) return;
    if (!this.validateLoginForm()) {
      return;
    }
    const phone = String(this.data.loginForm.phone || '').trim();
    const password = String(this.data.loginForm.password || '');

    this.setData({ submitting: true });
    wx.showLoading({
      title: '登录中...'
    });

    wx.cloud.callFunction({
      name: 'bindPhone',
      data: {
        phone,
        password
      },
      success: res => {
        this.setData({ submitting: false });
        wx.hideLoading();
        if (res.result.success) {
          wx.showToast({
            title: '登录成功',
            icon: 'success'
          });
          // 跳转首页
          wx.switchTab({
            url: '/pages/index/index'
          });
        } else {
          wx.showToast({
            title: res.result.message,
            icon: 'none'
          });
        }
      },
      fail: err => {
        this.setData({ submitting: false });
        wx.hideLoading();
        console.error('登录失败', err);
        wx.showToast({
          title: '登录失败',
          icon: 'none'
        });
      }
    });
  },

  registerUser: function() {
    if (this.data.submitting) return;
    if (!this.validateRegisterForm()) {
      return;
    }
    const phone = String(this.data.registerForm.phone || '').trim();
    const nickname = String(this.data.registerForm.nickname || '').trim();
    const password = String(this.data.registerForm.password || '');

    this.setData({ submitting: true });
    wx.showLoading({
      title: '注册中...'
    });

    wx.cloud.callFunction({
      name: 'registerUser',
      data: {
        phone,
        nickname,
        password
      },
      success: (res) => {
        this.setData({ submitting: false });
        wx.hideLoading();
        console.log('registerUser result', res);
        if (res.result && res.result.success) {
          wx.showToast({
            title: '注册成功',
            icon: 'success'
          });
          wx.switchTab({
            url: '/pages/index/index'
          });
        } else {
          const isTemplateEcho = !!(res.result && res.result.tcbContext && res.result.phone && !('success' in res.result));
          const msg = isTemplateEcho
            ? 'registerUser函数仍是模板代码，请重新部署'
            : ((res.result && (res.result.message || res.result.error)) || '注册失败');
          console.error('registerUser failed result:', res.result);
          wx.showToast({
            title: msg,
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        this.setData({ submitting: false });
        wx.hideLoading();
        console.error('注册失败', err);
        wx.showToast({
          title: '注册失败',
          icon: 'none'
        });
      }
    });
  },

  goBrowseHome: function() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});
