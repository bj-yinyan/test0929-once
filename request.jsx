/**
 * @file 通用API请求功能
 * @author zhanglili
 */

import axios from 'axios';
import {Modal} from 'antd';
import {partial, omitBy, omit, isEmpty} from 'lodash/fp';
import {stringifyQuery} from './queryString';
import {resolveURL} from './url';

const purify = omitBy(value => value == null);

const defaultOptions = {
    headers: {
        'Content-Type': 'application/json'
    }
};
const http = axios.create(defaultOptions);

const isFormPost = ({method, headers}) => (
    method === 'POST'
    && headers
    && headers['Content-Type'] === 'application/x-www-form-urlencoded'
);

export const confirmSessionLost = (() => {
    let confirming = false;

    return () => {
        if (confirming) {
            return;
        }

        confirming = true;
        // session超时以后不再捕获页面错误, 防止因超时错误引发的系列弹窗
        window.onerror = null;

        const config = {
            title: '会话超时',
            content: '当前会话已经超时，请刷新页面后重试',
            onOk() {
                if (process.env.NODE_ENV === 'development') {
                    window.location = '/welcome';
                }
                else {
                    window.location.href = `/?service=${window.location.href}`;
                }
            }
        };
        Modal.confirm(config);
    };
})();

const handleGlobalError = response => {
    const xhr = response.request;

    if (xhr.status === 0) {
        // 302状态，过uuap，请求被取消
        document.cookie = 'ICODE=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        document.cookie = 'BD_X_USER=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        confirmSessionLost();
    }

    throw response;
};

// 接口规范：http://wiki.baidu.com/pages/viewpage.action?pageId=345780791
const defaultUnwrapResponse = ({data: {status, message, data}}) => {
    if (status === 'OK') {
        return data;
    }

    const error = new Error(message);
    error.responseStatus = status;
    error.responseData = data;

    throw error;
};

const defaultUnwrapError = ({response, message, statusText, data}) => {
    if (response && response.data && response.data.status) {
        return defaultUnwrapResponse(response);
    }

    const error = new Error(message);
    error.responseStatus = statusText;
    error.responseData = data;

    throw error;
};

export const request = (method, rawURL, rawData, {unwrapResponse = defaultUnwrapResponse, ...extraOptions} = {}) => {
    const url = resolveURL(rawURL);
    const config = {url, method, ...extraOptions};

    if (rawData) {
        // `null`或`undefined`的参数默认不发送
        const data = purify(rawData);
        const key = method === 'GET' ? 'params' : 'data';
        config[key] = data;
    }

    if (isFormPost(config)) {
        config.data = stringifyQuery(config.data);
    }

    return http.request(config).catch(handleGlobalError).then(unwrapResponse).catch(defaultUnwrapError);
};

/**
 * 发送GET请求
 *
 * @param {string} rawURL 请求的URL
 * @param {Object} [data] 请求的数据，追加在参数后
 * @param {Object} [extraOptions] 额外的配置，不得包含`data`和`params`属性
 */
export const get = partial(request, ['GET']);

/**
 * 发送POST请求
 *
 * @param {string} rawURL 请求的URL
 * @param {Object} [data] 请求的数据，作为请求体
 * @param {Object} [extraOptions] 额外的配置，不得包含`data`和`params`属性
 */
export const post = partial(request, ['POST']);

/**
 * 使用URL的模板快速创建一个API接口
 *
 * @param {string} method HTTP动词
 * @param {string} urlTemplate URL模板，使用`${name}`作为变量占位符
 * @return {Function} 一个接收`data`和`extraOptions`的API接口函数
 */
export const createInterface = (method, urlTemplate, extraOptions) => {
    const variablesInTemplate = urlTemplate.match(/\{\w+\}/g);

    // URL模板中没有任何变量，直接将其作为URL创建一个高性能的函数
    if (isEmpty(variablesInTemplate)) {
        return data => request(method, urlTemplate, data, extraOptions);
    }

    const generateRequestData = omit(variablesInTemplate.map(s => s.slice(1, -1)));
    const generateURL = variables => urlTemplate.replace(/\{(\w+)\}/g, (match, name) => variables[name]);

    return rawData => {
        const url = generateURL(rawData);
        const requestData = generateRequestData(rawData);
        return request(method, url, requestData, extraOptions);
    };
};
