// 云函数入口文件 - 浏览量上报
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 浏览量权重
const VIEW_SCORE = 1

// 去重时间窗口（毫秒）：30分钟
const DEDUP_WINDOW = 30 * 60 * 1000

/**
 * 浏览量上报云函数
 * 
 * 功能：
 * 1. 验证帖子存在性
 * 2. 去重检查（同一用户30分钟内只记录一次）
 * 3. 原子更新 view_count 和 hot_score
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.postId - 帖子 ID
 * 
 * @returns {Object} { success: Boolean, message: String, recorded: Boolean }
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
      message: '参数错误：缺少帖子ID',
      recorded: false
    }
  }

  if (!openid) {
    return {
      success: false,
      message: '无法获取用户身份',
      recorded: false
    }
  }

  try {
    // ========== 1. 验证帖子存在 ==========
    const postRes = await db.collection('community_posts').doc(postId).get()
    
    if (!postRes.data) {
      return {
        success: false,
        message: '帖子不存在',
        recorded: false
      }
    }

    // 不统计自己的帖子浏览量
    if (postRes.data._openid === openid) {
      return {
        success: true,
        message: '不统计作者自己的浏览',
        recorded: false
      }
    }

    // ========== 2. 去重检查 ==========
    const now = Date.now()
    const windowStart = new Date(now - DEDUP_WINDOW)

    // 查询该用户在时间窗口内是否已有浏览记录
    const viewLogRes = await db.collection('community_view_logs')
      .where({
        post_id: postId,
        user_id: openid,
        create_time: _.gte(windowStart)
      })
      .limit(1)
      .get()

    if (viewLogRes.data && viewLogRes.data.length > 0) {
      // 时间窗口内已有记录，跳过
      return {
        success: true,
        message: '时间窗口内已记录过浏览',
        recorded: false
      }
    }

    // ========== 3. 记录浏览日志 ==========
    await db.collection('community_view_logs').add({
      data: {
        post_id: postId,
        user_id: openid,
        create_time: db.serverDate()
      }
    })

    // ========== 4. 原子更新浏览量和热度 ==========
    await db.collection('community_posts').doc(postId).update({
      data: {
        view_count: _.inc(1),
        hot_score: _.inc(VIEW_SCORE)
      }
    })

    console.log(`[浏览上报] 用户 ${openid} 浏览帖子 ${postId}，view_count +1, hot_score +${VIEW_SCORE}`)

    return {
      success: true,
      message: '浏览量已记录',
      recorded: true
    }

  } catch (err) {
    console.error('[浏览上报失败]', err)
    return {
      success: false,
      message: `上报失败: ${err.message || '未知错误'}`,
      recorded: false
    }
  }
}

