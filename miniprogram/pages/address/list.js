// pages/address/list.js
const app = getApp()
const db = wx.cloud.database()
const Dialog = require('@vant/weapp/dialog/dialog')

Page({
  data: {
    loading: true,
    list: [],
    // 从 checkout 跳入时为选择模式
    selectMode: false
  },

  onLoad(options) {
    if (options.select === '1') {
      this.setData({ selectMode: true })
    }
  },

  onShow() {
    this.loadList()
  },

  async loadList() {
    const openid = app.globalData.openid
    if (!openid) {
      this.setData({ loading: false })
      return
    }

    try {
      const res = await db.collection('shopping_addresses')
        .where({ _openid: openid })
        .orderBy('is_default', 'desc')
        .orderBy('update_time', 'desc')
        .limit(20)
        .get()

      this.setData({ list: res.data || [], loading: false })
    } catch (err) {
      console.error('加载地址列表失败:', err)
      this.setData({ loading: false })
    }
  },

  /** 选择地址（选择模式下才生效） */
  onSelect(e) {
    if (!this.data.selectMode) return

    const idx = e.currentTarget.dataset.idx
    const addr = this.data.list[idx]

    // 将选中地址写入全局事件通道，让 checkout 页面读取
    const pages = getCurrentPages()
    const prevPage = pages[pages.length - 2]
    if (prevPage) {
      prevPage.setData({
        address: {
          _id: addr._id,
          userName: addr.name,
          telNumber: addr.phone,
          provinceName: addr.province,
          cityName: addr.city,
          countyName: addr.district,
          detailInfo: addr.detail
        }
      })
    }

    wx.navigateBack()
  },

  /** 设置默认地址 */
  async setDefault(e) {
    const idx = e.currentTarget.dataset.idx
    const addr = this.data.list[idx]

    if (addr.is_default) return

    wx.showLoading({ title: '设置中...', mask: true })
    const openid = app.globalData.openid

    try {
      // 先把所有地址的 is_default 清除（前端只处理显示列表里的）
      const oldDefault = this.data.list.find(a => a.is_default)
      const tasks = []

      if (oldDefault) {
        tasks.push(
          db.collection('shopping_addresses').doc(oldDefault._id).update({
            data: { is_default: false, update_time: db.serverDate() }
          })
        )
      }

      tasks.push(
        db.collection('shopping_addresses').doc(addr._id).update({
          data: { is_default: true, update_time: db.serverDate() }
        })
      )

      await Promise.all(tasks)
      wx.hideLoading()
      wx.showToast({ title: '已设为默认', icon: 'success' })
      this.loadList()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '设置失败', icon: 'none' })
    }
  },

  /** 删除地址 */
  deleteAddr(e) {
    const idx = e.currentTarget.dataset.idx
    const addr = this.data.list[idx]

    Dialog.confirm({
      title: '删除地址',
      message: `确定删除 ${addr.name} 的收货地址？`,
      confirmButtonColor: '#ee0a24'
    }).then(async () => {
      try {
        await db.collection('shopping_addresses').doc(addr._id).remove()
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadList()
      } catch (err) {
        wx.showToast({ title: '删除失败', icon: 'none' })
      }
    }).catch(() => {})
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/address/edit' })
  },

  goEdit(e) {
    const idx = e.currentTarget.dataset.idx
    const addr = this.data.list[idx]
    wx.navigateTo({ url: `/pages/address/edit?id=${addr._id}` })
  }
})
