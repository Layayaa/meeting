// pages/reservationManage/reservationManage.js
Page({
  data: {
    reservations: [],
    filterDateFrom: '',
    filterDateTo: '',
    filterRoom: '',
    filterUserName: ''
  },

  onShow() {
    this.loadReservations()
  },

  loadReservations() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getReservationsAdmin',
        dateFrom: this.data.filterDateFrom,
        dateTo: this.data.filterDateTo,
        room: this.data.filterRoom,
        userName: this.data.filterUserName
      },
      success(res) {
        if (res.result.success === false) {
          wx.showToast({ title: res.result.message || '加载失败', icon: 'none' })
          return
        }
        const reservations = (res.result.reservations || []).map((item) => ({
          ...item,
          statusText: that.formatStatus(item.status)
        }))
        that.setData({ reservations })
      },
      fail(err) {
        console.error('加载失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  bindDateFromChange(e) {
    this.setData({ filterDateFrom: e.detail.value })
  },

  bindDateToChange(e) {
    this.setData({ filterDateTo: e.detail.value })
  },

  bindRoomChange(e) {
    this.setData({ filterRoom: e.detail.value })
  },

  bindUserNameChange(e) {
    this.setData({ filterUserName: e.detail.value })
  },

  formatStatus(status) {
    if (status === 'pending') return '待使用'
    if (status === 'completed') return '已完成'
    if (status === 'cancelled') return '已取消'
    return status || '未知'
  },

  search() {
    this.loadReservations()
  },

  forceCancel(e) {
    const reservationId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '强制取消',
      content: '确定强制取消该预约吗？',
      success(res) {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'serviceFunctions',
            data: { action: 'forceCancelReservation', reservationId },
            success(resp) {
              if (resp.result.success) {
                wx.showToast({ title: '取消成功', icon: 'success' })
                that.loadReservations()
              } else {
                wx.showToast({ title: resp.result.message || '取消失败', icon: 'none' })
              }
            },
            fail(err) {
              console.error('取消失败', err)
              wx.showToast({ title: '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  }
})
