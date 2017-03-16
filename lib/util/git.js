'use strict'

const BB = require('bluebird')

const cp = require('child_process')
const execFileAsync = BB.promisify(cp.execFile, {
  multiArgs: true
})
const finished = BB.promisify(require('mississippi').finished)
const normalizeGitUrl = require('normalize-git-url')
const optCheck = require('./opt-check')
const path = require('path')
const which = BB.promisify(require('which'))

module.exports.clone = fullClone
function fullClone (repo, committish, target, opts) {
  opts = optCheck(opts)
  const normed = normalizeGitUrl(repo)
  const gitArgs = [
    'clone',
    '-q',
    // Mainly for windows, but no harm done
    '-c', 'core.longpaths=true',
    normed.url,
    target
  ]
  return execGit(gitArgs, {
    cwd: path.dirname(target)
  }, opts).then(() => {
    return execGit(['checkout', committish, '-c', 'core.longpaths=true'], {
      cwd: target
    })
  }).then(() => headSha(repo, opts))
}

module.exports.shallow = shallowClone
function shallowClone (repo, branch, target, opts) {
  opts = optCheck(opts)
  const normed = normalizeGitUrl(repo)
  const gitArgs = [
    'clone',
    '--depth=1',
    '-q',
    '-b', branch,
    // Mainly for windows, but no harm done
    '-c', 'core.longpaths=true',
    normed.url,
    target
  ]
  return execGit(gitArgs, {
    cwd: path.dirname(target)
  }, opts).then(() => headSha(repo, opts))
}

function headSha (repo, opts) {
  opts = optCheck(opts)
  return execGit(['rev-parse', '--revs-only', 'HEAD', repo], {}, opts).spread(stdout => {
    return stdout.trim()
  })
}

module.exports.revs = revs
function revs (repo, opts) {
  opts = optCheck(opts)
  return spawnGit(['ls-remote', repo, '-t', '-h', '*'], {
    env: opts.gitEnv
  }, opts).then(child => {
    let stdout = ''
    child.stdout.on('data', d => { stdout += d })
    return finished(child).then(() => {
      return stdout.split('\n').reduce((revs, line) => {
        const split = line.split(/\s+/, 2)
        if (split.length < 2) { return revs }
        const sha = split[0].trim()
        const ref = split[1].trim().match(/(?:refs\/[^/]+\/)?(.*)/)[1]
        if (!ref) { return revs } // ???
        const type = refType(line)
        const doc = {sha, ref, type}

        revs.refs[ref] = doc
        // We can check out shallow clones on specific SHAs if we have a ref
        if (revs.shas[sha]) {
          revs.shas[sha].push(ref)
        } else {
          revs.shas[sha] = [ref]
        }

        if (type === 'tag') {
          const match = ref.match(/v?(\d+\.\d+\.\d+)$/)
          if (match) {
            revs.versions[match[1]] = doc
          }
        }

        return revs
      }, {versions: {}, 'dist-tags': {}, refs: {}, shas: {}})
    }).then(revs => {
      if (revs.refs.HEAD) {
        const HEAD = revs.refs.HEAD
        Object.keys(revs.versions).forEach(v => {
          if (v.sha === HEAD.sha) {
            revs['dist-tags'].HEAD = v
            if (!revs.refs.latest) {
              revs['dist-tags'].latest = revs.refs.HEAD
            }
          }
        })
      }
      return revs
    })
  })
}

module.exports._exec = execGit
function execGit (gitArgs, _gitOpts, opts) {
  opts = optCheck(opts)
  const gitOpts = {
    env: opts.gitEnv,
    uid: opts.uid,
    gid: opts.gid
  }
  Object.keys(_gitOpts || {}).forEach(k => {
    gitOpts[k] = _gitOpts[k]
  })
  return which(opts.gitPath).catch(err => {
    err.code = 'ENOGIT'
    throw err
  }).then(gitPath => {
    return execFileAsync(gitPath, gitArgs, gitOpts)
  })
}

module.exports._spawn = spawnGit
function spawnGit (gitArgs, _gitOpts, opts) {
  opts = optCheck(opts)
  const gitOpts = {
    env: opts.gitEnv,
    uid: opts.uid,
    gid: opts.gid
  }
  Object.keys(_gitOpts).forEach(k => {
    gitOpts[k] = _gitOpts[k]
  })
  return which(opts.gitPath).catch(err => {
    err.code = 'ENOGIT'
    throw err
  }).then(gitPath => {
    return cp.spawn(gitPath, gitArgs, gitOpts)
  })
}

function refType (ref) {
  return ref.match(/refs\/tags\/.*$/)
  ? 'tag'
  : ref.match(/refs\/heads\/.*$/)
  ? 'branch'
  : ref.match(/HEAD$/)
  ? 'head'
  : 'other'
}
