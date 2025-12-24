// 云函数入口文件 - 删除帖子
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 删除帖子云函数
 * 完整清理逻辑：帖子 + 评论 + 点赞 + 收藏 + 云存储图片 + 话题计数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.postId - 要删除的帖子 ID
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { postId } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!postId) {
    return {
      success: false,
      message: '参数错误：缺少帖子ID'
    }
  }

  try {
    // ========== 1. 查询帖子并校验权限 ==========
    const postRes = await db.collection('community_posts').doc(postId).get()
    
    if (!postRes.data) {
      return {
        success: false,
        message: '帖子不存在'
      }
    }

    const post = postRes.data

    // 权限校验：只有作者可以删除
    if (post._openid !== openid) {
      console.warn(`[安全警告] 用户 ${openid} 尝试删除他人帖子 ${postId}`)
      return {
        success: false,
        message: '无权删除他人帖子'
      }
    }

    console.log(`[删除帖子] 开始删除帖子 ${postId}`)

    // ========== 2. 处理话题计数减一（仅公开帖子需要减） ==========
    const tags = post.tags || []
    const isPublic = !post.status || post.status === 0  // 0 或 undefined 表示公开
    
    if (tags.length > 0 && isPublic) {
      console.log(`[删除帖子] 帖子关联 ${tags.length} 个话题，开始减少计数`)
      await decreaseTopicCounts(tags)
    }

    // ========== 3. 收集需要删除的云存储文件 ==========
    const fileIdsToDelete = []
    
    // 帖子图片
    if (post.images && post.images.length > 0) {
      post.images.forEach(img => {
        // 只处理云存储的文件（以 cloud:// 开头）
        if (img && img.startsWith('cloud://')) {
          fileIdsToDelete.push(img)
        }
      })
    }

    // ========== 4. 查询所有相关评论ID（用于后续删除点赞记录）==========
    const commentsRes = await db.collection('community_comments')
      .where({
        post_id: postId
      })
      .field({ _id: true })
      .get()
    
    const commentIds = (commentsRes.data || []).map(c => c._id)
    console.log(`[删除帖子] 找到 ${commentIds.length} 条评论需要删除`)

    // ========== 5. 开始清理（按依赖顺序） ==========
    const cleanupPromises = []

    // 5.1 删除评论点赞记录
    if (commentIds.length > 0) {
      cleanupPromises.push(
        db.collection('community_comment_likes')
          .where({
            comment_id: _.in(commentIds)
          })
          .remove()
          .then(res => console.log(`[清理] 删除了 ${res.stats.removed} 条评论点赞记录`))
          .catch(err => console.warn('[清理] 删除评论点赞记录失败:', err))
      )
    }

    // 5.2 删除帖子点赞记录
    cleanupPromises.push(
      db.collection('community_post_likes')
        .where({
          target_id: postId
        })
        .remove()
        .then(res => console.log(`[清理] 删除了 ${res.stats.removed} 条帖子点赞记录`))
        .catch(err => console.warn('[清理] 删除帖子点赞记录失败:', err))
    )

    // 5.3 删除收藏记录
    cleanupPromises.push(
      db.collection('community_collections')
        .where({
          post_id: postId
        })
        .remove()
        .then(res => console.log(`[清理] 删除了 ${res.stats.removed} 条收藏记录`))
        .catch(err => console.warn('[清理] 删除收藏记录失败:', err))
    )

    // 5.4 删除举报记录
    cleanupPromises.push(
      db.collection('community_reports')
        .where({
          target_id: postId
        })
        .remove()
        .then(res => console.log(`[清理] 删除了 ${res.stats.removed} 条举报记录`))
        .catch(err => console.warn('[清理] 删除举报记录失败:', err))
    )

    // 5.5 删除所有评论
    cleanupPromises.push(
      db.collection('community_comments')
        .where({
          post_id: postId
        })
        .remove()
        .then(res => console.log(`[清理] 删除了 ${res.stats.removed} 条评论`))
        .catch(err => console.warn('[清理] 删除评论失败:', err))
    )

    // 等待所有清理操作完成
    await Promise.all(cleanupPromises)

    // ========== 6. 删除帖子本身 ==========
    await db.collection('community_posts').doc(postId).remove()
    console.log(`[删除帖子] 帖子 ${postId} 已删除`)

    // ========== 7. 删除云存储图片（异步，不阻塞返回）==========
    if (fileIdsToDelete.length > 0) {
      // 不等待，异步执行
      cloud.deleteFile({
        fileList: fileIdsToDelete
      }).then(res => {
        console.log(`[清理] 删除了 ${fileIdsToDelete.length} 个云存储文件`)
      }).catch(err => {
        console.warn('[清理] 删除云存储文件失败:', err)
      })
    }

    return {
      success: true,
      message: '删除成功',
      deletedComments: commentIds.length
    }

  } catch (err) {
    console.error('[删除帖子失败]', err)
    return {
      success: false,
      message: `删除失败: ${err.message || '未知错误'}`
    }
  }
}

/**
 * 批量减少话题计数
 * @param {Array} tags - 话题名称数组
 */
async function decreaseTopicCounts(tags) {
  for (const tagName of tags) {
    try {
      // 先查询当前 count
      const topicRes = await db.collection('community_topics')
        .where({ name: tagName })
        .get()

      if (topicRes.data && topicRes.data.length > 0) {
        const currentCount = topicRes.data[0].count || 0
        
        if (currentCount <= 1) {
          // 如果 count 为 1 或更小，直接设为 0（不删除条目）
          await db.collection('community_topics')
            .where({ name: tagName })
            .update({
              data: { count: 0 }
            })
          console.log(`[话题] ${tagName} 计数已设为 0`)
        } else {
          // count > 1，执行 -1
          await db.collection('community_topics')
            .where({ name: tagName })
            .update({
              data: { count: _.inc(-1) }
            })
          console.log(`[话题] ${tagName} 计数 -1`)
        }
      }
    } catch (err) {
      console.warn(`[话题] 减少 ${tagName} 计数失败:`, err)
    }
  }
}
