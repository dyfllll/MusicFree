'use strict';
var md5 = require('./lib/md5');
var CryptoJS = require('./lib/crypto');
var base64 = require('./lib/base64');
var btoa = base64.btoa;

var getSkewTime = function (offset) {
  return Date.now() + (offset || 0);
};



// 可以签入签名的headers
var signHeaders = [
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-md5',
  'expect',
  'expires',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'origin',
  'range',
  'transfer-encoding',
  'pic-operations',
];


var getSignHeaderObj = function (headers) {
  var signHeaderObj = {};
  for (var i in headers) {
    var key = i.toLowerCase();
    if (key.indexOf('x-cos-') > -1 || signHeaders.indexOf(key) > -1) {
      signHeaderObj[i] = headers[i];
    }
  }
  return signHeaderObj;
};


function each(obj, fn) {
  for (var i in obj) {
    if (obj.hasOwnProperty(i)) {
      fn(obj[i], i);
    }
  }
}


function isArray(arr) {
  return arr instanceof Array;
}

function map(obj, fn) {
  var o = isArray(obj) ? [] : {};
  for (var i in obj) {
    if (obj.hasOwnProperty(i)) {
      o[i] = fn(obj[i], i);
    }
  }
  return o;
}

function clone(obj) {
  return map(obj, function (v) {
    return typeof v === 'object' && v !== null ? clone(v) : v;
  });
}

function camSafeUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function extend(target, source) {
  each(source, function (val, key) {
    target[key] = source[key];
  });
  return target;
}

var error = function (err, opt) {
  var sourceErr = err;
  err.message = err.message || null;

  if (typeof opt === 'string') {
    err.error = opt;
    err.message = opt;
  } else if (typeof opt === 'object' && opt !== null) {
    extend(err, opt);
    if (opt.code || opt.name) err.code = opt.code || opt.name;
    if (opt.message) err.message = opt.message;
    if (opt.stack) err.stack = opt.stack;
  }

  if (typeof Object.defineProperty === 'function') {
    Object.defineProperty(err, 'name', { writable: true, enumerable: false });
    Object.defineProperty(err, 'message', { enumerable: true });
  }

  err.name = (opt && opt.name) || err.name || err.code || 'Error';
  if (!err.code) err.code = err.name;
  if (!err.error) err.error = clone(sourceErr); // 兼容老的错误格式

  return err;
};

function getObjectKeys(obj, forKey) {
  var list = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      list.push(forKey ? camSafeUrlEncode(key).toLowerCase() : key);
    }
  }
  return list.sort(function (a, b) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    return a === b ? 0 : a > b ? 1 : -1;
  });
}

/**
 * obj转为string
 * @param  {Object}  obj                需要转的对象，必须
 * @param  {Boolean} lowerCaseKey       key是否转为小写，默认false，非必须
 * @return {String}  data               返回字符串
 */
var obj2str = function (obj, lowerCaseKey) {
  var i, key, val;
  var list = [];
  var keyList = getObjectKeys(obj);
  for (i = 0; i < keyList.length; i++) {
    key = keyList[i];
    val = obj[key] === undefined || obj[key] === null ? '' : '' + obj[key];
    key = lowerCaseKey ? camSafeUrlEncode(key).toLowerCase() : camSafeUrlEncode(key);
    val = camSafeUrlEncode(val) || '';
    list.push(key + '=' + val);
  }
  return list.join('&');
};


var getAuth = function (opt) {
  opt = opt || {};

  var SecretId = opt.SecretId;
  var SecretKey = opt.SecretKey;
  var KeyTime = opt.KeyTime;
  var method = (opt.method || opt.Method || 'get').toLowerCase();
  var queryParams = clone(opt.Query || opt.params || {});
  var headers = getSignHeaderObj(clone(opt.Headers || opt.headers || {}));

  var Key = opt.Key || '';
  var pathname;
  if (opt.UseRawKey) {
    pathname = opt.Pathname || opt.pathname || '/' + Key;
  } else {
    pathname = opt.Pathname || opt.pathname || Key;
    pathname.indexOf('/') !== 0 && (pathname = '/' + pathname);
  }

  // ForceSignHost明确传入false才不加入host签名
  var forceSignHost = opt.ForceSignHost === false ? false : true;


  // 如果有传入存储桶，那么签名默认加 Host 参与计算，避免跨桶访问
  if (!headers.Host && !headers.host && opt.Bucket && opt.Region && forceSignHost)
    headers.Host = opt.Bucket + '.cos.' + opt.Region + '.myqcloud.com';

  if (!SecretId) return console.error('missing param SecretId');
  if (!SecretKey) return console.error('missing param SecretKey');

  // 签名有效起止时间
  var now = Math.round(getSkewTime(opt.SystemClockOffset) / 1000) - 1;
  var exp = now;

  var Expires = opt.Expires || opt.expires;
  if (Expires === undefined) {
    exp += 900; // 签名过期时间为当前 + 900s
  } else {
    exp += Expires * 1 || 0;
  }

  // 要用到的 Authorization 参数列表
  var qSignAlgorithm = 'sha1';
  var qAk = SecretId;
  var qSignTime = KeyTime || now + ';' + exp;
  var qKeyTime = KeyTime || now + ';' + exp;
  var qHeaderList = getObjectKeys(headers, true).join(';').toLowerCase();
  var qUrlParamList = getObjectKeys(queryParams, true).join(';').toLowerCase();

  // 签名算法说明文档：https://www.qcloud.com/document/product/436/7778
  // 步骤一：计算 SignKey
  var signKey = CryptoJS.HmacSHA1(qKeyTime, SecretKey).toString();

  // 步骤二：构成 FormatString
  var formatString = [method, pathname, obj2str(queryParams, true), obj2str(headers, true), ''].join('\n');

  // 步骤三：计算 StringToSign
  var stringToSign = ['sha1', qSignTime, CryptoJS.SHA1(formatString).toString(), ''].join('\n');

  // 步骤四：计算 Signature
  var qSignature = CryptoJS.HmacSHA1(stringToSign, signKey).toString();

  // 步骤五：构造 Authorization
  var authorization = [
    'q-sign-algorithm=' + qSignAlgorithm,
    'q-ak=' + qAk,
    'q-sign-time=' + qSignTime,
    'q-key-time=' + qKeyTime,
    'q-header-list=' + qHeaderList,
    'q-url-param-list=' + qUrlParamList,
    'q-signature=' + qSignature,
  ].join('&');

  return authorization;
};


// 生成操作 url
function getUrl(params) {
  var longBucket = params.bucket;
  var shortBucket = longBucket.substr(0, longBucket.lastIndexOf('-'));
  var appId = longBucket.substr(longBucket.lastIndexOf('-') + 1);
  var domain = params.domain;
  var region = params.region;
  var object = params.object;
  var protocol = 'https:';
  if (!domain) {
    if (['cn-south', 'cn-south-2', 'cn-north', 'cn-east', 'cn-southwest', 'sg'].indexOf(region) > -1) {
      domain = '{Region}.myqcloud.com';
    } else {
      domain = 'cos.{Region}.myqcloud.com';
    }
    if (!params.ForcePathStyle) {
      domain = '{Bucket}.' + domain;
    }
  }
  domain = domain
    .replace(/\{\{AppId\}\}/gi, appId)
    .replace(/\{\{Bucket\}\}/gi, shortBucket)
    .replace(/\{\{Region\}\}/gi, region)
    .replace(/\{\{.*?\}\}/gi, '');
  domain = domain
    .replace(/\{AppId\}/gi, appId)
    .replace(/\{BucketName\}/gi, shortBucket)
    .replace(/\{Bucket\}/gi, longBucket)
    .replace(/\{Region\}/gi, region)
    .replace(/\{.*?\}/gi, '');
  if (!/^[a-zA-Z]+:\/\//.test(domain)) {
    domain = protocol + '//' + domain;
  }

  // 去掉域名最后的斜杆
  if (domain.slice(-1) === '/') {
    domain = domain.slice(0, -1);
  }
  var url = domain;

  if (params.ForcePathStyle) {
    url += '/' + longBucket;
  }
  url += '/';
  if (object) {
    url += camSafeUrlEncode(object).replace(/%2F/g, '/');
  }

  if (params.isLocation) {
    url = url.replace(/^https?:\/\//, '');
  }
  return url;
}

var getSignHost = function (opt) {
  if (!opt.Bucket || !opt.Region) return '';
  var useAccelerate = opt.UseAccelerate === undefined ? this.options.UseAccelerate : opt.UseAccelerate;
  var url =
    opt.Url ||
    getUrl({
      ForcePathStyle: this.options.ForcePathStyle,
      protocol: this.options.Protocol,
      domain: this.options.Domain,
      bucket: opt.Bucket,
      region: useAccelerate ? 'accelerate' : opt.Region,
    });
  var urlHost = url.replace(/^https?:\/\/([^/]+)(\/.*)?$/, '$1');
  return urlHost;
};

var noop = function () { };

var binaryBase64 = function (str) {
  var i,
    len,
    char,
    res = '';
  for (i = 0, len = str.length / 2; i < len; i++) {
    char = parseInt(str[i * 2] + str[i * 2 + 1], 16);
    res += String.fromCharCode(char);
  }
  return btoa(res);
};
var uuid = function () {
  var S4 = function () {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  };
  return S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4();
};


// 获取文件内容的 MD5
var getBodyMd5 = function (UploadCheckContentMd5, Body, callback) {
  callback = callback || noop;
  if (UploadCheckContentMd5) {
    // if (Body && Body instanceof ArrayBuffer) 
    if (Body) {
      getFileMd5(Body, function (err, md5) {
        callback(md5);
      });
    } else {
      callback();
    }
  } else {
    callback();
  }
};

// 获取文件 md5 值
var getFileMd5 = function (body, callback) {
  var hash = md5(body);
  callback && callback(hash);
  return hash;
};


// 异步获取签名
function getAuthorizationAsync(params, callback) {
  var headers = clone(params.Headers);
  var headerHost = '';
  each(headers, function (v, k) {
    (v === '' || ['content-type', 'cache-control'].indexOf(k.toLowerCase()) > -1) && delete headers[k];
    if (k.toLowerCase() === 'host') headerHost = v;
  });

  // ForceSignHost明确传入false才不加入host签名
  var forceSignHost = params.ForceSignHost === false ? false : true;
  // Host 加入签名计算
  if (!headerHost && params.SignHost && forceSignHost) headers.Host = params.SignHost;

  // 获取凭证的回调，避免用户 callback 多次
  var cbDone = false;
  var cb = function (err, AuthData) {
    if (cbDone) return;
    cbDone = true;
    if (AuthData && AuthData.XCosSecurityToken && !AuthData.SecurityToken) {
      AuthData = clone(AuthData);
      AuthData.SecurityToken = AuthData.XCosSecurityToken;
      delete AuthData.XCosSecurityToken;
    }
    callback && callback(err, AuthData);
  };

  var self = this;
  var Bucket = params.Bucket || '';
  var Region = params.Region || '';

  // PathName
  var KeyName = params.Action === 'name/cos:PostObject' || !params.Key ? '' : params.Key;
  if (self.options.ForcePathStyle && Bucket) {
    KeyName = Bucket + '/' + KeyName;
  }
  var Pathname = '/' + KeyName;

  // 内部计算获取签名
  return (function () {
    var KeyTime = '';
    if (self.options.StartTime && params.Expires) {
      if (self.options.StartTime.toString().length !== 10) {
        return cb(error(new Error('params "StartTime" should be 10 digits')));
      }
      KeyTime = self.options.StartTime + ';' + (self.options.StartTime + params.Expires * 1);
    } else if (self.options.StartTime && self.options.ExpiredTime) {
      if (self.options.StartTime.toString().length !== 10) {
        return cb(error(new Error('params "StartTime" should be 10 digits')));
      }
      if (self.options.ExpiredTime.toString().length !== 10) {
        return cb(error(new Error('params "ExpiredTime" should be 10 digits')));
      }
      KeyTime = self.options.StartTime + ';' + self.options.ExpiredTime * 1;
    }
    var Authorization = getAuth({
      SecretId: params.SecretId || self.options.SecretId,
      SecretKey: params.SecretKey || self.options.SecretKey,
      Method: params.Method,
      Pathname: Pathname,
      Query: params.Query,
      Headers: headers,
      Expires: params.Expires,
      KeyTime,
      SystemClockOffset: self.options.SystemClockOffset,
      ForceSignHost: forceSignHost,
    });
    var AuthData = {
      Authorization: Authorization,
      SecurityToken: self.options.SecurityToken || self.options.XCosSecurityToken,
      SignFrom: 'client',
    };
    cb(null, AuthData);
    return AuthData;
  })();

}




/**
* 获取文件下载链接
* @param  {Object}  params                 参数对象，必须
      @param  {String}  params.SecretId    SecretId名称，必须
      @param  {String}  params.SecretKey   SecretKey名称，必须
*     @param  {String}  params.Bucket      Bucket名称，必须
*     @param  {String}  params.Region      地域名称，必须
*     @param  {String}  params.Key         object名称，必须
*     @param  {String}  params.Method      请求的方法，可选
*     @param  {String}  params.Expires     签名超时时间，单位秒，可选
* @param  {Function}  callback             回调函数，必须
*     @return  {Object}    err             请求失败的错误，如果请求成功，则为空。https://cloud.tencent.com/document/product/436/7730
*     @return  {Object}    data            返回的数据
*/
function getObjectUrl(params, callback) {
  var self = this;

  self.options = {};
  self.options.ForcePathStyle = false;

  var useAccelerate = params.UseAccelerate === undefined ? self.options.UseAccelerate : params.UseAccelerate;
  var url = getUrl({
    ForcePathStyle: self.options.ForcePathStyle,
    protocol: params.Protocol || self.options.Protocol,
    domain: params.Domain || self.options.Domain,
    bucket: params.Bucket,
    region: useAccelerate ? 'accelerate' : params.Region,
    object: params.Key,
  });

  var queryParamsStr = '';
  if (params.Query) {
    queryParamsStr += obj2str(params.Query);
  }
  if (params.QueryString) {
    queryParamsStr += (queryParamsStr ? '&' : '') + params.QueryString;
  }

  var syncUrl = url;
  if (params.Sign !== undefined && !params.Sign) {
    queryParamsStr && (syncUrl += '?' + queryParamsStr);
    callback(null, { Url: syncUrl });
    return syncUrl;
  }

  // 签名加上 Host，避免跨桶访问
  var SignHost = getSignHost.call(this, {
    Bucket: params.Bucket,
    Region: params.Region,
    UseAccelerate: params.UseAccelerate,
    Url: url,
  });
  var AuthData = getAuthorizationAsync.call(
    this,
    {
      SecretId: params.SecretId || '',
      SecretKey: params.SecretKey||'',
      Action: (params.Method || '').toUpperCase() === 'PUT' ? 'name/cos:PutObject' : 'name/cos:GetObject',
      Bucket: params.Bucket || '',
      Region: params.Region || '',
      Method: params.Method || 'get',
      Key: params.Key,
      Expires: params.Expires,
      Headers: params.Headers,
      Query: params.Query,
      SignHost: SignHost,
      ForceSignHost: params.ForceSignHost === false ? false : self.options.ForceSignHost, // getObjectUrl支持传参ForceSignHost
    },
    function (err, AuthData) {
      if (!callback) return;
      if (err) {
        callback(err);
        return;
      }

      // 兼容万象url qUrlParamList需要再encode一次
      var replaceUrlParamList = function (url) {
        var urlParams = url.match(/q-url-param-list.*?(?=&)/g)[0];
        var encodedParams =
          'q-url-param-list=' + encodeURIComponent(urlParams.replace(/q-url-param-list=/, '')).toLowerCase();
        var reg = new RegExp(urlParams, 'g');
        var replacedUrl = url.replace(reg, encodedParams);
        return replacedUrl;
      };

      var signUrl = url;
      signUrl +=
        '?' +
        (AuthData.Authorization.indexOf('q-signature') > -1
          ? replaceUrlParamList(AuthData.Authorization)
          : 'sign=' + encodeURIComponent(AuthData.Authorization));
      AuthData.SecurityToken && (signUrl += '&x-cos-security-token=' + AuthData.SecurityToken);
      AuthData.ClientIP && (signUrl += '&clientIP=' + AuthData.ClientIP);
      AuthData.ClientUA && (signUrl += '&clientUA=' + AuthData.ClientUA);
      AuthData.Token && (signUrl += '&token=' + AuthData.Token);
      queryParamsStr && (signUrl += '&' + queryParamsStr);
      // setTimeout(function () {
        
      // });

      callback(null, { Url: signUrl });
    }
  );

  if (AuthData) {
    syncUrl +=
      '?' + AuthData.Authorization + (AuthData.SecurityToken ? '&x-cos-security-token=' + AuthData.SecurityToken : '');
    queryParamsStr && (syncUrl += '&' + queryParamsStr);
  } else {
    queryParamsStr && (syncUrl += '?' + queryParamsStr);
  }
  return syncUrl;
}

var util = {

  extend: extend,
  isArray: isArray,

  each: each,
  map: map,

  clone: clone,

  camSafeUrlEncode: camSafeUrlEncode,

  getSkewTime: getSkewTime,
  obj2str: obj2str,
  getAuth: getAuth,
  getUrl: getUrl,

  error: error,
  getBodyMd5: getBodyMd5,
  binaryBase64: binaryBase64,
  getObjectUrl: getObjectUrl
};

module.exports = util;