'use strict';

const fs = require('fs');
const path = require('path');

let logger;
logger = require('../logger').getLogger('util/atMostOnce', newLogger => {
  logger = newLogger;
});

// Cache determined main package json as these will be referenced often
// and identification of these values is expensive.
let parsedMainPackageJson;
let mainPackageJsonPath;
let nodeModulesPath;
let appInstalledIntoNodeModules = false;

exports.isAppInstalledIntoNodeModules = function isAppInstalledIntoNodeModules() {
  return appInstalledIntoNodeModules;
};

exports.getMainPackageJson = function getMainPackageJson(startDirectory, cb) {
  if (typeof startDirectory === 'function') {
    cb = startDirectory;
    startDirectory = null;
  }

  if (parsedMainPackageJson !== undefined) {
    return process.nextTick(cb, null, parsedMainPackageJson);
  }

  exports.getMainPackageJsonPath(startDirectory, (err, packageJsonPath) => {
    if (err) {
      // fs.readFile would have called cb asynchronously later, so we use process.nextTick here to make all paths async.
      return process.nextTick(cb, err, null);
    }
    if (packageJsonPath == null) {
      // fs.readFile would have called cb asynchronously later, so we use process.nextTick here to make all paths async.
      return process.nextTick(cb);
    }

    fs.readFile(packageJsonPath, { encoding: 'utf8' }, (readFileErr, contents) => {
      if (readFileErr) {
        return cb(readFileErr, null);
      }

      try {
        parsedMainPackageJson = JSON.parse(contents);
      } catch (e) {
        logger.warn('Main package.json file %s cannot be parsed: %s', packageJsonPath, e);
        return cb(e, null);
      }
      return cb(null, parsedMainPackageJson);
    });
  });
};

exports.getMainPackageJsonPath = function getMainPackageJsonPath(startDirectory, cb) {
  if (typeof startDirectory === 'function') {
    cb = startDirectory;
    startDirectory = null;
  }

  if (mainPackageJsonPath !== undefined) {
    // searchForPackageJsonInDirectoryTreeUpwards would have called cb asynchronously later,
    // so we use process.nextTick here to make all paths async.
    return process.nextTick(cb, null, mainPackageJsonPath);
  }

  if (!startDirectory) {
    // No explicit starting directory for searching for the main package.json has been provided, use the Node.js
    // process' main module as the starting point.
    const mainModule = process.mainModule;

    if (!mainModule) {
      // This happens
      // a) when the Node CLI is evaluating an expression, or
      // b) when the REPL is used, or
      // c) when we have been pre-required with the --require/-r command line flag
      // In particular for case (c) we want to try again later. This is handled in the individual metrics that rely on
      // evaluating the package.json file.
      return process.nextTick(cb);
    }
    startDirectory = path.dirname(mainModule.filename);
  }

  searchForPackageJsonInDirectoryTreeUpwards(startDirectory, (err, main) => {
    if (err) {
      return cb(err, null);
    }

    mainPackageJsonPath = main;
    return cb(null, mainPackageJsonPath);
  });
};

function searchForPackageJsonInDirectoryTreeUpwards(dir, cb) {
  const pathToCheck = path.join(dir, 'package.json');

  fs.stat(pathToCheck, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return searchInParentDir(dir, searchForPackageJsonInDirectoryTreeUpwards, cb);
      } else {
        // searchInParentDir would have called cb asynchronously,
        // so we use process.nextTick here to make all paths async.
        return process.nextTick(cb, err, null);
      }
    }

    appInstalledIntoNodeModules = dir.indexOf('node_modules') >= 0;
    if (appInstalledIntoNodeModules) {
      // Some users do not deploy their app by cloning/copying the app's sources to the target system and installing its
      // dependencies via npm/yarn there. Instead, they publish the whole app into an npm-compatible registry and use
      // npm install $appName on the target system to deploy the app including its dependencies. In this scenario, we
      // need to skip the check for an accompanying node_modules folder (see below). We can recognize this pattern
      // (heuristically) by the fact that the segment 'node_modules' already appears in the path to the main module.
      return process.nextTick(cb, null, pathToCheck);
    }

    // If the package.json file actually exists, we also need to make sure that there is a node_modules directory
    // located next to it. This way we can be relatively certain that we did not encounter a component package.json
    // (as used by React for example). It is highly unlikely that the application has no dependencies, because
    // @instana/core is a dependency itself.
    if (stats.isFile()) {
      const potentialNodeModulesDir = path.join(dir, 'node_modules');
      fs.stat(potentialNodeModulesDir, (statErr, potentialNodeModulesDirStats) => {
        if (statErr) {
          if (statErr.code === 'ENOENT') {
            return searchInParentDir(dir, searchForPackageJsonInDirectoryTreeUpwards, cb);
          }
          // searchInParentDir would have called cb asynchronously,
          // so we use process.nextTick here to make all paths async.
          return process.nextTick(cb, statErr, null);
        }

        if (potentialNodeModulesDirStats.isDirectory()) {
          // We have found a package.json which has dependencies located next to it. We assume that this is the
          // package.json file we are looking for.

          // Also, searchInParentDir would have called cb asynchronously,
          // so we use process.nextTick here to make all paths async.
          return process.nextTick(cb, null, pathToCheck);
        } else {
          return searchInParentDir(dir, searchForPackageJsonInDirectoryTreeUpwards, cb);
        }
      });
    } else {
      return searchInParentDir(dir, searchForPackageJsonInDirectoryTreeUpwards, cb);
    }
  });
}

exports.findNodeModulesFolder = function findNodeModulesFolder(cb) {
  if (nodeModulesPath !== undefined) {
    return process.nextTick(cb, null, nodeModulesPath);
  }

  const mainModule = process.mainModule;
  if (!mainModule) {
    return process.nextTick(cb);
  }
  const startDirectory = path.dirname(mainModule.filename);

  searchForNodeModulesInDirectoryTreeUpwards(startDirectory, (err, nodeModulesPath_) => {
    if (err) {
      return cb(err, null);
    }

    nodeModulesPath = nodeModulesPath_;
    return cb(null, nodeModulesPath);
  });
};

function searchForNodeModulesInDirectoryTreeUpwards(dir, cb) {
  const pathToCheck = path.join(dir, 'node_modules');

  fs.stat(pathToCheck, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return searchInParentDir(dir, searchForNodeModulesInDirectoryTreeUpwards, cb);
      } else {
        // searchInParentDir would have called cb asynchronously,
        // so we use process.nextTick here to make all paths async.
        return process.nextTick(cb, err, null);
      }
    }

    if (stats.isDirectory()) {
      return process.nextTick(cb, null, pathToCheck);
    } else {
      return searchInParentDir(dir, searchForNodeModulesInDirectoryTreeUpwards, cb);
    }
  });
}

function searchInParentDir(dir, onParentDir, cb) {
  const parentDir = path.resolve(dir, '..');
  if (dir === parentDir) {
    // We have arrived at the root of the file system hierarchy.
    //
    // searchForPackageJsonInDirectoryTreeUpwards would have called cb asynchronously,
    // so we use process.nextTick here to make all paths async.
    return process.nextTick(cb, null, null);
  }

  return onParentDir(parentDir, cb);
}
