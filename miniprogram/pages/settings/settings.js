// pages/settings/settings.js
Page({
  data: {
    weekly_default: 1,
    reset_time: '22:00',
    reset_day: 6
  },

  onShow() {
    this.loadSettings()
  },

  loadSettings() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getSettings' },
      success(res) {
        if (res.result && res.result.settings) {
          const settings = res.result.settings
          that.setData({
            weekly_default: settings.weekly_default || 1,
            reset_time: settings.reset_time || '22:00',
            reset_day: typeof settings.reset_day === 'number' ? settings.reset_day : 6
          })
        }
      },
      fail(err) {
        console.error('加载设置失败', err)
        wx.showToast({ title: '加载设置失败', icon: 'none' })
      }
    })
  },

  bindDefaultChange(e) {
    this.setData({ weekly_default: Number(e.detail.value) })
  },

  saveSettings() {
    const { weekly_default, reset_time, reset_day } = this.data
    if (!weekly_default || weekly_default <= 0) {
      wx.showToast({ title: '请输入正确的默认次数', icon: 'none' })
      return
    }
    if (!reset_time) {
      wx.showToast({ title: '请输入刷新时间', icon: 'none' })
      return
    }
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'updateSettings',
        weekly_default,
        reset_time,
        reset_day
      },
      success(res) {
        if (res.result && res.result.success) {
          wx.showToast({ title: '保存成功', icon: 'success' })
          that.loadSettings()
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' })
        }
      },
      fail(err) {
        console.error('保存设置失败', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  refreshWeeklyCounts() {
    const that = this
    wx.showModal({
      title: '立即重置',
      content: '确认立即刷新所有用户本周使用次数吗？',
      success(res) {
        if (res.confirm) {
          wx.showLoading({ title: '重置中...' })
          wx.cloud.callFunction({
            name: 'serviceFunctions',
            data: { action: 'refreshWeeklyCounts' },
            success(resp) {
              wx.hideLoading()
              if (resp.result && resp.result.success) {
                wx.showToast({ title: '重置成功', icon: 'success' })
              } else {
                wx.showToast({ title: resp.result.message || '重置失败', icon: 'none' })
              }
            },
            fail(err) {
              wx.hideLoading()
              console.error('重置失败', err)
              wx.showToast({ title: '重置失败', icon: 'none' })
            }
          })
        }
      }
    })
  }
})
