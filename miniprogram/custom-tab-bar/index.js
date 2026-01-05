Component({
  data: {
    active: 0,
    unreadCount: 0 // 未读消息数
  },

  methods: {
    /**
     * 切换 Tab
     */
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset
      
      if (this.data.active === index) return
      
      this.setData({ active: index })
      
      wx.switchTab({
        url: path
      })
    },

    /**
     * 更新选中状态（由页面调用）
     */
    updateActive(index) {
      this.setData({ active: index })
    },

    /**
     * 更新未读消息数（由页面调用）
     */
    updateUnreadCount(count) {
      this.setData({ unreadCount: count })
    }
  }
})

