// pages/reservationManage/reservationManage.js
Page({
  data: {
    reservations: [],
    displayReservations: [],
    filterDateFrom: '',
    filterDateTo: '',
    filterRoom: '',
    filterUserName: '',
    statusTab: 'all',
    statusTabs: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待使用' },
      { key: 'expired', label: '已过期' },
      { key: 'cancelled', label: '已取消' }
    ]
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
          uiStatus: that.getUIStatus(item),
          statusText: that.formatStatus(that.getUIStatus(item))
        }))
        that.setData({ reservations })
        that.applyStatusFilter()
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
    if (status === 'expired') return '已过期'
    if (status === 'cancelled') return '已取消'
    if (status === 'completed') return '已完成'
    return status || '未知'
  },

  parseReservationEndTime(reservation) {
    const slot = String(reservation.time_slot || '')
    const parts = slot.split('-')
    const end = parts[1]
    if (!end || !reservation.date) return null
    const dt = new Date(`${reservation.date}T${end}:00`)
    if (Number.isNaN(dt.getTime())) return null
    return dt
  },

  getUIStatus(reservation) {
    if (reservation.status === 'cancelled') return 'cancelled'
    const endTime = this.parseReservationEndTime(reservation)
    if (endTime && new Date() > endTime) return 'expired'
    return 'pending'
  },

  selectStatusTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.statusTab) return
    this.setData({ statusTab: tab })
    this.applyStatusFilter()
  },

  applyStatusFilter() {
    const tab = this.data.statusTab
    const list = this.data.reservations || []
    let displayReservations = list
    if (tab !== 'all') {
      displayReservations = list.filter((item) => item.uiStatus === tab)
    }
    this.setData({ displayReservations })
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
