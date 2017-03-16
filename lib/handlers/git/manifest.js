'use strict'

const BB = require('bluebird')

const git = require('../../util/git')
const normalizeGitUrl = require('normalize-git-url')
const optCheck = require('../../util/opt-check')
const pickManifest = require('../../registry/pick-manifest')
const semver = require('semver')

module.exports = manifest
function manifest (spec, opts) {
  opts = optCheck(opts)
  // TODO - spec.hosted url stuff should be done in hosted handler
  const normed = normalizeGitUrl(spec.hosted ? spec.hosted.ssh : spec.spec)
  const rawRef = decodeURIComponent(normed.branch)
  return resolve(
    normed.url, rawRef, spec.name, opts
  ).then(ref => {
    if (ref) {
      return {
        _repo: normed.url,
        _resolved: `${normed.url}#${ref.sha}`,
        _spec: spec,
        _ref: ref,
        _rawRef: rawRef,
        _uniqueResolved: `${normed.url}#${ref.sha}`
      }
    } else {
      // We're SOL and need a full clone :(
      //
      // If we're confident enough that `rawRef` is a commit SHA,
      // then we can at least get `finalize-manifest` to cache its result.
      return {
        _repo: normed.url,
        _rawRef: rawRef,
        _resolved: rawRef.match(/^[a-f0-9]{40}$/) && `${normed.url}#${rawRef}`,
        _uniqueResolved: rawRef.match(/^[a-f0-9]{40}$/) && `${normed.url}#${rawRef}`
      }
    }
  })
}

function resolve (url, rawRef, name, opts) {
  const semverMatch = rawRef.match(/^semver:v?(.*)/)
  const isSemver = semverMatch && semver.validRange(semverMatch[1])
  return git.revs(url, opts).then(remoteRefs => {
    return isSemver
    ? pickManifest({
      versions: remoteRefs.versions,
      'dist-tags': remoteRefs['dist-tags'],
      name: name
    }, {
      type: 'range',
      spec: semverMatch[1]
    }, opts)
    : remoteRefs
    ? BB.resolve(
      remoteRefs.refs[rawRef] || remoteRefs.refs[remoteRefs.shas[rawRef]]
    )
    : null
  })
}
