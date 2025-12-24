// pages/community/post.js
const app = getApp()
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
    showTopicSearch: false, // 话题搜索浮层显示状态
    
    // 编辑模式相关
    isEditMode: false,      // 是否为编辑模式
    editPostId: '',         // 编辑的帖子ID
    originalImages: [],     // 原始图片列表（用于判断是否有删除）
    
    // 记录新创建的话题（发布时需要入库）
    newTopics: [],
    
    // 推荐话题标签（预设高频标签）
    recommendTags: ['非遗打卡', '周末去哪儿', '匠心', '手艺人', '传统文化'],
    
    // 非遗项目选项
    projectOptions: ['不关联', '湘绣', '滩头木版年画', '菊花石雕', '长沙花鼓戏', '女书', '土家族织锦', '苗族银饰']
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 检测是否为编辑模式
    if (options.id) {
      this.setData({ 
        isEditMode: true, 
        editPostId: options.id 
      })
      wx.setNavigationBarTitle({ title: '编辑笔记' })
      this.loadPostData(options.id)
    }
  },

  /**
   * 加载帖子数据（编辑模式）
   */
  async loadPostData(postId) {
    wx.showLoading({ title: '加载中...' })

    try {
      const res = await db.collection('community_posts').doc(postId).get()
      
      if (!res.data) {
        wx.hideLoading()
        wx.showToast({ title: '帖子不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }

      const post = res.data

      // 权限校验：只能编辑自己的帖子
      if (post._openid !== app.globalData.openid) {
        wx.hideLoading()
        wx.showToast({ title: '无权编辑此帖子', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }

      // 转换图片格式为 fileList
      const fileList = (post.images || []).map(url => ({
        url: url,
        tempFilePath: url,
        status: 'done',
        isCloud: true  // 标记为云存储图片
      }))

      // 填充表单数据
      this.setData({
        title: post.title || '',
        content: post.content || '',
        fileList: fileList,
        originalImages: post.images || [],
        selectedTags: post.tags || [],
        selectedProject: post.related_projects && post.related_projects.length > 0 
          ? post.related_projects[0].name 
          : '',
        location: post.location || {}
      })

      wx.hideLoading()

    } catch (err) {
      console.error('加载帖子数据失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
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
   * 删除图片（仅发布模式可用）
   */
  deleteImage(event) {
    // 编辑模式禁止删除图片
    if (this.data.isEditMode) {
      wx.showToast({ title: '编辑模式下不可修改图片', icon: 'none' })
      return
    }
    const { index } = event.detail
    const fileList = [...this.data.fileList]
    fileList.splice(index, 1)
    this.setData({ fileList })
  },

  /**
   * 预览编辑模式下的图片
   */
  previewEditImage(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.fileList.map(f => f.url)
    wx.previewImage({
      current: urls[index],
      urls: urls
    })
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

  // ========== 话题标签相关方法 ==========

  /**
   * 切换预设标签选择
   */
  togglePresetTag(e) {
    const tag = e.currentTarget.dataset.tag
    const selectedTags = [...this.data.selectedTags]
    const index = selectedTags.indexOf(tag)
    
    if (index > -1) {
      // 已选中，移除
      selectedTags.splice(index, 1)
      // 同时从 newTopics 中移除（如果存在）
      const newTopics = this.data.newTopics.filter(t => t !== tag)
      this.setData({ selectedTags, newTopics })
    } else {
      // 未选中，添加
      if (selectedTags.length >= 10) {
        wx.showToast({
          title: '最多添加10个话题',
          icon: 'none'
        })
        return
      }
      selectedTags.push(tag)
      this.setData({ selectedTags })
    }
  },

  /**
   * 移除已选标签
   */
  removeTag(e) {
    const index = e.currentTarget.dataset.index
    const selectedTags = [...this.data.selectedTags]
    const removedTag = selectedTags[index]
    selectedTags.splice(index, 1)
    
    // 同时从 newTopics 中移除（如果存在）
    const newTopics = this.data.newTopics.filter(t => t !== removedTag)
    
    this.setData({ selectedTags, newTopics })
  },

  /**
   * 打开话题搜索浮层
   */
  openTopicSearch() {
    // 检查是否已达到最大数量
    if (this.data.selectedTags.length >= 10) {
      wx.showToast({
        title: '最多添加10个话题',
        icon: 'none'
      })
      return
    }
    this.setData({ showTopicSearch: true })
  },

  /**
   * 关闭话题搜索浮层
   */
  closeTopicSearch() {
    this.setData({ showTopicSearch: false })
  },

  /**
   * 话题选中回调
   */
  onTopicSelect(e) {
    const { name, isNew } = e.detail
    const selectedTags = [...this.data.selectedTags]
    const newTopics = [...this.data.newTopics]
    
    // 添加到已选标签
    selectedTags.push(name)
    
    // 如果是新创建的话题，记录下来
    if (isNew) {
      newTopics.push(name)
    }
    
    this.setData({ 
      selectedTags, 
      newTopics,
      showTopicSearch: false 
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
   * 发布/更新帖子
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

    const isEditMode = this.data.isEditMode

    // 2. 显示加载
    wx.showLoading({
      title: isEditMode ? '保存中...' : '发布中...',
      mask: true
    })

    try {
      // 3. 处理图片：区分已上传的云图片和新增的本地图片
      const uploadedImages = []
      const newLocalImages = []
      
      this.data.fileList.forEach(file => {
        const url = file.tempFilePath || file.url
        if (url.startsWith('cloud://')) {
          // 已上传到云存储的图片，直接使用
          uploadedImages.push(url)
        } else {
          // 新增的本地图片，需要上传
          newLocalImages.push(file)
        }
      })

      // 4. 上传新增的本地图片
      for (let i = 0; i < newLocalImages.length; i++) {
        const file = newLocalImages[i]
        const tempFilePath = file.tempFilePath || file.url
        
        // 生成唯一文件名
        const timestamp = Date.now()
        const random = Math.floor(Math.random() * 10000)
        const ext = tempFilePath.split('.').pop() || 'jpg'
        const cloudPath = `posts/${timestamp}_${random}_${i}.${ext}`
        
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath
        })
        
        uploadedImages.push(uploadRes.fileID)
        
        // 更新进度
        wx.showLoading({
          title: `上传中 ${i + 1}/${newLocalImages.length}`,
          mask: true
        })
      }

      // 5. 获取当前登录用户信息
      const userInfo = app.globalData.userInfo
      if (!userInfo) {
        wx.hideLoading()
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        })
        return
      }

      // 6. 处理话题入库（新创建的话题需要添加到 community_topics）
      await this.syncTopicsToDatabase()

      if (isEditMode) {
        // ========== 编辑模式：更新帖子（图片不可修改）==========
        
        // 构建更新数据（不包含 images，保持原有图片不变）
        const updateData = {
          title: this.data.title || '分享一下',
          content: this.data.content || '',
          // 注意：编辑模式不修改 images 字段
          location: {
            name: this.data.location.name,
            latitude: this.data.location.latitude,
            longitude: this.data.location.longitude
          },
          related_projects: this.data.selectedProject ? [{ name: this.data.selectedProject }] : [],
          tags: this.data.selectedTags,
          // 编辑记录
          is_edited: true,
          last_edit_time: db.serverDate(),
          // 更新作者信息（可能头像昵称有变化）
          author_info: {
            nickname: userInfo.nickname,
            avatar_file_id: userInfo.avatar_url,
            is_certified: userInfo.is_certified || false
          }
        }

        // 更新数据库
        await db.collection('community_posts').doc(this.data.editPostId).update({
          data: updateData
        })

        wx.hideLoading()
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        })

        // 通知详情页刷新
        const pages = getCurrentPages()
        const detailPage = pages.find(p => p.route === 'pages/community/detail')
        if (detailPage && detailPage.loadPostDetail) {
          detailPage.loadPostDetail()
        }

      } else {
        // ========== 新建模式：发布帖子 ==========
        
        // 构建帖子数据
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
          comment_count: 0,
          collection_count: 0,
          status: 0,           // 0: 公开
          comment_status: true, // 默认允许评论
          is_top: false,       // 默认不置顶
          is_edited: false,    // 默认未编辑过
          author_id: userInfo._id,
          author_info: {
            nickname: userInfo.nickname,
            avatar_file_id: userInfo.avatar_url,
            is_certified: userInfo.is_certified || false
          }
        }

        // 写入数据库
        await db.collection('community_posts').add({
          data: postData
        })

        wx.hideLoading()
        wx.showToast({
          title: '发布成功',
          icon: 'success'
        })
      }

      // 延迟返回
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)

    } catch (err) {
      console.error(isEditMode ? '保存失败:' : '发布失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: isEditMode ? '保存失败，请重试' : '发布失败，请重试',
        icon: 'none'
      })
    }
  },

  /**
   * 同步话题到数据库
   * - 新话题：创建新记录，count=1
   * - 已有话题：count+1
   */
  async syncTopicsToDatabase() {
    const selectedTags = this.data.selectedTags
    const newTopics = this.data.newTopics

    if (selectedTags.length === 0) return

    const _ = db.command

    for (const tagName of selectedTags) {
      try {
        if (newTopics.includes(tagName)) {
          // 新话题：直接创建
          await db.collection('community_topics').add({
            data: {
              name: tagName,
              count: 1,
              create_time: db.serverDate()
            }
          })
          console.log(`[话题] 创建新话题: ${tagName}`)
        } else {
          // 已有话题：尝试增加 count
          // 使用 where + update 来匹配 name 并更新
          const updateRes = await db.collection('community_topics')
            .where({ name: tagName })
            .update({
              data: {
                count: _.inc(1)
              }
            })
          
          // 如果没有更新到任何记录，说明话题不存在（可能是预设标签首次使用）
          if (updateRes.stats.updated === 0) {
            await db.collection('community_topics').add({
              data: {
                name: tagName,
                count: 1,
                create_time: db.serverDate()
              }
            })
            console.log(`[话题] 预设标签首次入库: ${tagName}`)
          } else {
            console.log(`[话题] 已有话题热度+1: ${tagName}`)
          }
        }
      } catch (err) {
        // 如果是重复键错误（话题已存在），尝试更新 count
        if (err.errCode === -502005 || err.message?.includes('duplicate')) {
          try {
            await db.collection('community_topics')
              .where({ name: tagName })
              .update({
                data: {
                  count: _.inc(1)
                }
              })
            console.log(`[话题] 重复创建，改为更新热度: ${tagName}`)
          } catch (updateErr) {
            console.warn(`[话题] 更新热度失败: ${tagName}`, updateErr)
          }
        } else {
          console.warn(`[话题] 处理话题失败: ${tagName}`, err)
        }
      }
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
