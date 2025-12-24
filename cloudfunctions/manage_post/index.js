// 云函数入口文件 - 帖子管理
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 帖子管理云函数
 * 用于：权限设置、评论开关、置顶
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.postId - 帖子 ID
 * @param {String} event.action - 操作类型：'privacy' | 'comment_toggle' | 'top'
 * @param {Any} event.value - 新值
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { postId, action, value } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!postId || !action) {
    return {
      success: false,
      message: '参数错误：缺少必要参数'
    }
  }

  const allowedActions = ['privacy', 'comment_toggle', 'top']
  if (!allowedActions.includes(action)) {
    return {
      success: false,
      message: '参数错误：不支持的操作类型'
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

    // 权限校验：只有作者可以操作
    if (post._openid !== openid) {
      console.warn(`[安全警告] 用户 ${openid} 尝试操作他人帖子 ${postId}`)
      return {
        success: false,
        message: '无权操作他人帖子'
      }
    }

    // ========== 2. 根据 action 执行不同操作 ==========
    let updateData = {}
    let logMessage = ''

    switch (action) {
      case 'privacy':
        // 权限设置：0=公开，1=私密
        if (value !== 0 && value !== 1) {
          return {
            success: false,
            message: '参数错误：status 值无效'
          }
        }
        
        // 获取当前状态
        const currentStatus = post.status || 0  // 默认公开
        const newStatus = value
        const tags = post.tags || []
        
        // 状态发生变化且帖子有标签时，更新话题计数
        if (currentStatus !== newStatus && tags.length > 0) {
          if (newStatus === 1) {
            // 公开 -> 私密：话题 count - 1
            console.log(`[帖子管理] 帖子 ${postId} 设为私密，减少 ${tags.length} 个话题计数`)
            await updateTopicCounts(tags, -1)
          } else {
            // 私密 -> 公开：话题 count + 1
            console.log(`[帖子管理] 帖子 ${postId} 设为公开，增加 ${tags.length} 个话题计数`)
            await updateTopicCounts(tags, 1)
          }
        }
        
        updateData.status = value
        logMessage = value === 1 ? '设为私密' : '设为公开'
        break

      case 'comment_toggle':
        // 评论开关
        if (typeof value !== 'boolean') {
          return {
            success: false,
            message: '参数错误：comment_status 值无效'
          }
        }
        updateData.comment_status = value
        logMessage = value ? '开启评论' : '关闭评论'
        break

      case 'top':
        // 置顶
        if (typeof value !== 'boolean') {
          return {
            success: false,
            message: '参数错误：is_top 值无效'
          }
        }
        updateData.is_top = value
        logMessage = value ? '置顶' : '取消置顶'
        break
    }

    // ========== 3. 执行更新 ==========
    updateData.update_time = db.serverDate()
    
    await db.collection('community_posts').doc(postId).update({
      data: updateData
    })

    console.log(`[帖子管理] 用户 ${openid} 对帖子 ${postId} 执行了「${logMessage}」操作`)

    return {
      success: true,
      message: '操作成功'
    }

  } catch (err) {
    console.error('[帖子管理失败]', err)
    return {
      success: false,
      message: `操作失败: ${err.message || '未知错误'}`
    }
  }
}

/**
 * 批量更新话题计数
 * @param {Array} tags - 话题名称数组
 * @param {Number} amount - 变化量（+1 或 -1）
 */
async function updateTopicCounts(tags, amount) {
  for (const tagName of tags) {
    try {
      if (amount < 0) {
        // 减少计数：需要先检查当前值，防止变成负数
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
      } else {
        // 增加计数：直接 +1
        const updateRes = await db.collection('community_topics')
          .where({ name: tagName })
          .update({
            data: { count: _.inc(amount) }
          })
        
        // 如果话题不存在，创建它
        if (updateRes.stats.updated === 0) {
          await db.collection('community_topics').add({
            data: {
              name: tagName,
              count: 1,
              create_time: db.serverDate()
            }
          })
          console.log(`[话题] 创建新话题: ${tagName}`)
        } else {
          console.log(`[话题] ${tagName} 计数 +${amount}`)
        }
      }
    } catch (err) {
      console.warn(`[话题] 更新 ${tagName} 计数失败:`, err)
    }
  }
}
