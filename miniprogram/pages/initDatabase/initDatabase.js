// pages/initDatabase/initDatabase.js
Page({
  data: {
    loading: false,
    result: null
  },

  initDatabase() {
    const that = this
    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: 'initDatabase',
      success(res) {
        that.setData({
          loading: false,
          result: res.result
        })

        if (res.result.success) {
          wx.showToast({
            title: '初始化成功',
            icon: 'success'
          })
        } else {
          wx.showToast({
            title: '初始化失败',
            icon: 'none'
          })
        }
      },
      fail(err) {
        that.setData({ loading: false })
        console.error('初始化失败', err)
        wx.showToast({
          title: '初始化失败',
          icon: 'none'
        })
      }
    })
  }
})