// 云函数入口文件 - 删除评论
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

/**
 * 删除评论云函数
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.commentId - 要删除的评论 ID
 * @param {String} event.postId - 所属帖子 ID
 * @param {Boolean} event.isRootComment - 是否是一级评论
 * 
 * @returns {Object} { success: Boolean, message: String }
 */
exports.main = async (event, context) => {
  const { commentId, postId, isRootComment } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 参数校验 ==========
  if (!commentId || !postId) {
    return {
      success: false,
      message: '参数错误：缺少必要参数'
    }
  }

  try {
    // ========== 1. 获取评论并校验权限 ==========
    const commentRes = await db.collection('community_comments').doc(commentId).get()
    
    if (!commentRes.data) {
      return {
        success: false,
        message: '评论不存在'
      }
    }

    const comment = commentRes.data

    // 校验是否是评论作者
    if (comment.from_uid !== openid) {
      return {
        success: false,
        message: '无权删除他人评论'
      }
    }

    // ========== 2. 根据评论类型执行不同的删除逻辑 ==========
    if (isRootComment) {
      // ===== 删除一级评论（物理删除）=====
      return await deleteRootComment(commentId, postId, comment)
    } else {
      // ===== 删除二级评论（逻辑删除）=====
      return await deleteReplyComment(commentId, postId, comment)
    }

  } catch (err) {
    console.error('[删除评论失败]', err)
    return {
      success: false,
      message: `删除失败: ${err.message || '未知错误'}`
    }
  }
}

/**
 * 删除一级评论（物理删除）
 * - 删除该评论及其所有回复
 * - 帖子 comment_count 减去 (1 + 回复数)
 * - 删除相关点赞记录
 */
async function deleteRootComment(commentId, postId, comment) {
  const replyCount = comment.reply_count || 0
  const totalDeleteCount = 1 + replyCount // 一级评论 + 所有回复

  // 使用事务确保原子性
  const transaction = await db.startTransaction()

  try {
    // 1. 查找所有需要删除的评论 ID（包括一级评论和它的所有回复）
    const repliesRes = await transaction.collection('community_comments')
      .where({
        root_id: commentId
      })
      .field({ _id: true })
      .get()

    const replyIds = (repliesRes.data || []).map(r => r._id)
    const allCommentIds = [commentId, ...replyIds]

    // 2. 删除一级评论
    await transaction.collection('community_comments').doc(commentId).remove()
    console.log(`[事务] 删除一级评论: ${commentId}`)

    // 3. 删除所有回复（如果有）
    if (replyIds.length > 0) {
      // 云数据库事务中需要逐条删除
      for (const replyId of replyIds) {
        await transaction.collection('community_comments').doc(replyId).remove()
      }
      console.log(`[事务] 删除 ${replyIds.length} 条回复`)
    }

    // 4. 更新帖子评论数
    await transaction.collection('community_posts').doc(postId).update({
      data: {
        comment_count: _.inc(-totalDeleteCount)
      }
    })
    console.log(`[事务] 帖子评论数 -${totalDeleteCount}`)

    // 5. 提交事务
    await transaction.commit()
    console.log('[事务] 提交成功')

    // 6. 事务外：删除点赞记录（点赞记录删除失败不影响主流程）
    try {
      await db.collection('community_comment_likes')
        .where({
          comment_id: _.in(allCommentIds)
        })
        .remove()
      console.log('[清理] 删除相关点赞记录')
    } catch (likeErr) {
      console.warn('[清理] 删除点赞记录失败（不影响主流程）:', likeErr)
    }

    return {
      success: true,
      message: '删除成功',
      deletedCount: totalDeleteCount
    }

  } catch (err) {
    // 回滚事务
    await transaction.rollback()
    console.error('[事务] 回滚:', err)
    throw err
  }
}

/**
 * 删除二级评论（逻辑删除）
 * - 将评论状态改为 deleted，内容改为提示语
 * - 删除相关点赞记录
 * - 不减少帖子评论数
 */
async function deleteReplyComment(commentId, postId, comment) {
  // 使用事务确保原子性
  const transaction = await db.startTransaction()

  try {
    // 1. 逻辑删除：更新评论状态和内容
    await transaction.collection('community_comments').doc(commentId).update({
      data: {
        status: 'deleted',
        content: '该评论已由作者删除',
        like_count: 0
      }
    })
    console.log(`[事务] 逻辑删除二级评论: ${commentId}`)

    // 2. 提交事务
    await transaction.commit()
    console.log('[事务] 提交成功')

    // 3. 事务外：删除点赞记录
    try {
      await db.collection('community_comment_likes')
        .where({
          comment_id: commentId
        })
        .remove()
      console.log('[清理] 删除该评论的点赞记录')
    } catch (likeErr) {
      console.warn('[清理] 删除点赞记录失败（不影响主流程）:', likeErr)
    }

    return {
      success: true,
      message: '删除成功',
      isLogicalDelete: true
    }

  } catch (err) {
    // 回滚事务
    await transaction.rollback()
    console.error('[事务] 回滚:', err)
    throw err
  }
}

