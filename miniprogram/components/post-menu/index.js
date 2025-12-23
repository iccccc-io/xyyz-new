// components/post-menu/index.js
const app = getApp()
const db = wx.cloud.database()

Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 是否显示菜单
    show: {
      type: Boolean,
      value: false
    },
    // 帖子数据
    postData: {
      type: Object,
      value: null
    },
    // 帖子ID
    postId: {
      type: String,
      value: ''
    },
    // 是否是作者
    isAuthor: {
      type: Boolean,
      value: false
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    showReportMenu: false,  // 是否显示举报二级菜单
    loading: false,         // 操作加载中
    // 举报理由选项
    reportReasons: [
      { label: '色情低俗', value: 'porn' },
      { label: '暴力血腥', value: 'violence' },
      { label: '广告引流', value: 'ads' },
      { label: '侵权抄袭', value: 'copyright' },
      { label: '虚假信息', value: 'fake' },
      { label: '其他违规', value: 'other' }
    ]
  },

  /**
   * 组件的方法列表
   */
  methods: {
    /**
     * 关闭菜单
     */
    onClose() {
      this.setData({ showReportMenu: false })
      this.triggerEvent('close')
    },

    /**
     * 点击举报 - 显示二级菜单
     */
    onReportTap() {
      this.setData({ showReportMenu: true })
    },

    /**
     * 举报菜单返回
     */
    onReportBack() {
      this.setData({ showReportMenu: false })
    },

    /**
     * 提交举报
     */
    async onReportSubmit(e) {
      const reason = e.currentTarget.dataset.reason
      const myOpenid = app.globalData.openid

      if (!myOpenid) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      this.setData({ loading: true })

      try {
        // 检查是否已举报过
        const existRes = await db.collection('community_reports')
          .where({
            target_id: this.data.postId,
            reporter_id: myOpenid
          })
          .count()

        if (existRes.total > 0) {
          wx.showToast({ title: '您已举报过该帖子', icon: 'none' })
          this.setData({ loading: false })
          return
        }

        // 写入举报记录
        await db.collection('community_reports').add({
          data: {
            target_id: this.data.postId,
            target_type: 'post',
            reason: reason,
            reporter_id: myOpenid,
            create_time: db.serverDate(),
            status: 'pending'  // pending: 待处理, resolved: 已处理
          }
        })

        this.setData({ loading: false })
        wx.showToast({ title: '举报成功，感谢反馈', icon: 'success' })
        this.onClose()

      } catch (err) {
        console.error('举报失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '举报失败', icon: 'none' })
      }
    },

    /**
     * 编辑帖子
     */
    onEditTap() {
      this.onClose()
      wx.navigateTo({
        url: `/pages/community/post?id=${this.data.postId}`
      })
    },

    /**
     * 删除帖子
     */
    async onDeleteTap() {
      const res = await wx.showModal({
        title: '删除帖子',
        content: '确定要删除这篇帖子吗？删除后不可恢复，所有评论、点赞、收藏也将被清除。',
        confirmText: '删除',
        confirmColor: '#e74c3c'
      })

      if (!res.confirm) return

      this.setData({ loading: true })

      try {
        const result = await wx.cloud.callFunction({
          name: 'delete_post',
          data: {
            postId: this.data.postId
          }
        })

        this.setData({ loading: false })

        if (result.result && result.result.success) {
          wx.showToast({ title: '删除成功', icon: 'success' })
          this.onClose()
          // 通知父页面刷新并返回
          this.triggerEvent('deleted')
          setTimeout(() => {
            wx.navigateBack()
          }, 1000)
        } else {
          wx.showToast({ 
            title: result.result?.message || '删除失败', 
            icon: 'none' 
          })
        }
      } catch (err) {
        console.error('删除帖子失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '删除失败', icon: 'none' })
      }
    },

    /**
     * 切换权限设置（公开/私密）
     */
    async onPrivacyTap() {
      const currentStatus = this.data.postData.status || 0
      const newStatus = currentStatus === 1 ? 0 : 1

      this.setData({ loading: true })

      try {
        const result = await wx.cloud.callFunction({
          name: 'manage_post',
          data: {
            postId: this.data.postId,
            action: 'privacy',
            value: newStatus
          }
        })

        this.setData({ loading: false })

        if (result.result && result.result.success) {
          const msg = newStatus === 1 ? '已设为私密' : '已设为公开'
          wx.showToast({ title: msg, icon: 'success' })
          // 触发更新事件
          this.triggerEvent('update', { 
            field: 'status', 
            value: newStatus 
          })
          this.onClose()
        } else {
          wx.showToast({ 
            title: result.result?.message || '操作失败', 
            icon: 'none' 
          })
        }
      } catch (err) {
        console.error('切换权限失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },

    /**
     * 切换评论区开关
     */
    async onCommentToggleTap() {
      const currentStatus = this.data.postData.comment_status
      // 默认是开启的（undefined 或 true 都视为开启）
      const newStatus = currentStatus === false ? true : false

      this.setData({ loading: true })

      try {
        const result = await wx.cloud.callFunction({
          name: 'manage_post',
          data: {
            postId: this.data.postId,
            action: 'comment_toggle',
            value: newStatus
          }
        })

        this.setData({ loading: false })

        if (result.result && result.result.success) {
          const msg = newStatus ? '已开启评论' : '已关闭评论'
          wx.showToast({ title: msg, icon: 'success' })
          // 触发更新事件
          this.triggerEvent('update', { 
            field: 'comment_status', 
            value: newStatus 
          })
          this.onClose()
        } else {
          wx.showToast({ 
            title: result.result?.message || '操作失败', 
            icon: 'none' 
          })
        }
      } catch (err) {
        console.error('切换评论开关失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    },

    /**
     * 切换置顶状态
     */
    async onTopTap() {
      const currentTop = this.data.postData.is_top || false
      const newTop = !currentTop

      this.setData({ loading: true })

      try {
        const result = await wx.cloud.callFunction({
          name: 'manage_post',
          data: {
            postId: this.data.postId,
            action: 'top',
            value: newTop
          }
        })

        this.setData({ loading: false })

        if (result.result && result.result.success) {
          const msg = newTop ? '已置顶' : '已取消置顶'
          wx.showToast({ title: msg, icon: 'success' })
          // 触发更新事件
          this.triggerEvent('update', { 
            field: 'is_top', 
            value: newTop 
          })
          this.onClose()
        } else {
          wx.showToast({ 
            title: result.result?.message || '操作失败', 
            icon: 'none' 
          })
        }
      } catch (err) {
        console.error('切换置顶失败:', err)
        this.setData({ loading: false })
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    }
  }
})

