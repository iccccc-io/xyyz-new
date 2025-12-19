// pages/community/post.js
const db = wx.cloud.database()

Page({
  /**
   * 页面的初始数据
   */
  data: {
    fileList: [],           // 图片列表
    title: '',              // 标题
    content: '',            // 正文
    selectedTags: [],       // 选中的标签
    selectedProject: '',    // 选中的非遗项目
    location: {},           // 位置信息
    showPicker: false,      // 项目选择器显示状态
    
    // 推荐话题标签
    recommendTags: ['非遗打卡', '周末去哪儿', '匠心', '手艺人', '传统文化'],
    
    // 非遗项目选项
    projectOptions: ['不关联', '湘绣', '滩头木版年画', '菊花石雕', '长沙花鼓戏', '女书', '土家族织锦', '苗族银饰']
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 图片上传后
   */
  afterRead(event) {
    const { file } = event.detail
    const fileList = [...this.data.fileList]
    
    // 支持单张和多张
    const files = Array.isArray(file) ? file : [file]
    
    files.forEach(f => {
      fileList.push({
        url: f.url,
        tempFilePath: f.url,
        status: 'done'
      })
    })
    
    this.setData({ fileList })
  },

  /**
   * 删除图片
   */
  deleteImage(event) {
    const { index } = event.detail
    const fileList = [...this.data.fileList]
    fileList.splice(index, 1)
    this.setData({ fileList })
  },

  /**
   * 标题输入
   */
  onTitleInput(e) {
    this.setData({
      title: e.detail.value
    })
  },

  /**
   * 正文输入
   */
  onContentInput(e) {
    this.setData({
      content: e.detail.value
    })
  },

  /**
   * 切换标签选择
   */
  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag
    const selectedTags = [...this.data.selectedTags]
    const index = selectedTags.indexOf(tag)
    
    if (index > -1) {
      selectedTags.splice(index, 1)
    } else {
      selectedTags.push(tag)
    }
    
    this.setData({ selectedTags })
  },

  /**
   * 添加自定义标签
   */
  addCustomTag() {
    wx.showModal({
      title: '添加话题',
      editable: true,
      placeholderText: '输入话题名称',
      success: (res) => {
        if (res.confirm && res.content) {
          const tag = res.content.trim()
          if (tag && !this.data.selectedTags.includes(tag)) {
            this.setData({
              selectedTags: [...this.data.selectedTags, tag]
            })
          }
        }
      }
    })
  },

  /**
   * 显示项目选择器
   */
  showProjectPicker() {
    this.setData({ showPicker: true })
  },

  /**
   * 隐藏项目选择器
   */
  hideProjectPicker() {
    this.setData({ showPicker: false })
  },

  /**
   * 确认选择项目
   */
  onProjectConfirm(e) {
    const { value } = e.detail
    this.setData({
      selectedProject: value === '不关联' ? '' : value,
      showPicker: false
    })
  },

  /**
   * 选择位置
   */
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: {
            name: res.name || res.address,
            latitude: res.latitude,
            longitude: res.longitude
          }
        })
      },
      fail: (err) => {
        console.log('选择位置失败:', err)
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '提示',
            content: '需要授权位置权限才能标记地点',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting()
              }
            }
          })
        }
      }
    })
  },

  /**
   * 保存草稿
   */
  saveDraft() {
    wx.showToast({
      title: '草稿已保存',
      icon: 'success'
    })
  },

  /**
   * 发布帖子
   */
  async publishPost() {
    // 1. 校验
    if (this.data.fileList.length === 0) {
      wx.showToast({
        title: '请至少选择一张图片',
        icon: 'none'
      })
      return
    }

    if (!this.data.location.name) {
      wx.showToast({
        title: '请标记地点',
        icon: 'none'
      })
      return
    }

    // 2. 显示加载
    wx.showLoading({
      title: '发布中...',
      mask: true
    })

    try {
      // 3. 上传图片
      const uploadedImages = []
      
      for (let i = 0; i < this.data.fileList.length; i++) {
        const file = this.data.fileList[i]
        const tempFilePath = file.tempFilePath || file.url
        
        // 生成唯一文件名
        const timestamp = Date.now()
        const random = Math.floor(Math.random() * 10000)
        const ext = tempFilePath.split('.').pop()
        const cloudPath = `posts/${timestamp}_${random}_${i}.${ext}`
        
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath
        })
        
        uploadedImages.push(uploadRes.fileID)
        
        // 更新进度
        wx.showLoading({
          title: `上传中 ${i + 1}/${this.data.fileList.length}`,
          mask: true
        })
      }

      // 4. 构建帖子数据
      const postData = {
        title: this.data.title || '分享一下',
        content: this.data.content || '',
        images: uploadedImages,
        location: {
          name: this.data.location.name,
          latitude: this.data.location.latitude,
          longitude: this.data.location.longitude
        },
        related_projects: this.data.selectedProject ? [{ name: this.data.selectedProject }] : [],
        tags: this.data.selectedTags,
        create_time: new Date().toISOString(),
        likes: 0,
        comments: [],
        // 模拟当前用户（硬编码使用"伊人绣庄"信息，方便演示红名效果）
        author_id: 'user_master_001',
        author_info: {
          nickname: '伊人绣庄',
          avatar_file_id: 'cloud://xiangyunyizhen-dev-1d02h7036c82a.7869-xiangyunyizhen-dev-1d02h7036c82a-1316629372/avatars/头像1.jpg',
          is_certified: true
        }
      }

      // 5. 写入数据库
      await db.collection('community_posts').add({
        data: postData
      })

      // 6. 发布成功
      wx.hideLoading()
      wx.showToast({
        title: '发布成功',
        icon: 'success'
      })

      // 7. 延迟返回
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)

    } catch (err) {
      console.error('发布失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '发布失败，请重试',
        icon: 'none'
      })
    }
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})

