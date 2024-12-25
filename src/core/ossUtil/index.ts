import 'react-native-url-polyfill/auto'; // 使 URL API 在 React Native 环境中工作
import Config, { IConfigPaths } from '@/core/config';
import cosUtil from './cos-wx-sdk-v5/cos-wx-sdk-v5.js';
import { S3, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import axios from 'axios';

let getOssSecretId = () => Config.get('setting.basic.ossSecretId') ?? '';
let getOssSecretKey = () => Config.get('setting.basic.ossSecretKey') ?? '';
let getOssBucket = () => Config.get('setting.basic.ossBucket') ?? '';
let getOssRegion = () => Config.get('setting.basic.ossRegion') ?? '';


const ossPathData = 'data/320k';
const ossPathBackup = 'music/backup/MusicFree/PlaylistBackup.json';

export const ossPluginName = 'oss';
export const ossPluginHash = 'oss';

let isSetup = false;

let s3Client: S3;
let s3SecretId = "";
let s3SecretKey = "";
let s3Local = true;
let s3Bucket = "";
let s3Region = "us-east-1";
let s3EndpointLocal = "";
let s3EndpointServer = "";



async function setup() {
    let local;
    if (await getLocalState()) {
        local = true;
    } else {
        local = false;
    }
    isSetup = true;
    Config.set('setting.basic.s3Local', local);
    console.log("use s3 url:" + (local ? s3EndpointLocal : s3EndpointServer));
    console.log('oss setup');
}



async function getLocalState() {
    try {
        const s3Client = getS3Object();
        const command = new HeadObjectCommand({
            Bucket: s3Bucket,
            Key: "home.txt",
        });
        const s3Url = await getSignedUrl(s3Client, command);
        // const response = await fetch(s3Url, {
        //     method: 'HEAD',
        // });
        const response = await axios.head(s3Url, { timeout: 500 });

        if (isSuccessfulStatus(response.status)) {
            return true;
        }
    } catch (error) {
    }
    return false;
}

function getS3Object() {
    const secretId = Config.get('setting.basic.s3SecretId') ?? '';
    const secretKey = Config.get('setting.basic.s3SecretKey') ?? '';
    const bucket = Config.get("setting.basic.s3Bucket") ?? "";
    const endpointLocal = Config.get("setting.basic.s3EndpointLocal") ?? "";
    const endpointServer = Config.get("setting.basic.s3EndpointServer") ?? "";
    const local = isSetup ? Config.get("setting.basic.s3Local") ?? false : true;

    let create = false;
    create = create || s3Client == null;
    create = create || s3SecretId != secretId;
    create = create || s3SecretKey != secretKey;
    // create = create || s3Bucket != bucket;
    create = create || s3EndpointLocal != endpointLocal;
    create = create || s3EndpointServer != endpointServer;
    create = create || s3Local != local;

    if (create) {
        const config = {
            region: s3Region,
            credentials: {
                accessKeyId: secretId,
                secretAccessKey: secretKey,
            },
            endpoint: local ? endpointLocal : endpointServer,
            forcePathStyle: true,
        };
        s3Client = new S3(config);
    }

    s3SecretId = secretId;
    s3SecretKey = secretKey;
    s3Bucket = bucket;
    s3EndpointLocal = endpointLocal;
    s3EndpointServer = endpointServer;
    s3Local = local;

    return s3Client;
}


function checkOssPlatform(musicItem: IMusic.IMusicItem) {
    return musicItem.platform == ossPluginName;
}


function isSuccessfulStatus(status: number): boolean {
    return status >= 200 && status < 300;
}



function getS3PathKey(
    musicItem: IMusic.IMusicItem,
) {
    if (checkOssPlatform(musicItem)) { return musicItem.id; }
    else { return `${ossPathData}/${musicItem.title}-${musicItem.artist}.mp3`; }
}

async function getS3Url(keyPath: string) {
    try {
        const command = new GetObjectCommand({
            Bucket: s3Bucket,
            Key: keyPath,
        });
        const url = await getSignedUrl(getS3Object(), command);
        return url;
    } catch (err) {

        return undefined;
    }

}

//检测文件是否存在
async function checkS3Exist(musicItem: IMusic.IMusicItem) {
    let hasFile = false;
    let ossPath: string = '';

    if (musicItem) {
        ossPath = getS3PathKey(musicItem);
        try {
            const command = new HeadObjectCommand({
                Bucket: s3Bucket,
                Key: ossPath,
            });
            const s3Url = await getSignedUrl(getS3Object(), command);
            const response = await fetch(s3Url, {
                method: 'HEAD',
            });
            hasFile = response.ok;
        } catch (error) {
            hasFile = false;
        }
    }
    return { ossExist: hasFile, ossKeyPath: ossPath };
}


async function uploadS3File(musicItem: IMusic.IMusicItem, filePath: string) {
    if (filePath == "") return false;
    try {
        const ossPath = getS3PathKey(musicItem)

        const responseRead = await fetch(filePath);
        let blob = await responseRead.blob();
        console.log('读取文件成功:' + blob.size);

        if (blob.size == 0) {
            console.log('读取文件失败,size=0');
            return false;
        }

        const contentType = "application/octet-stream";

        console.log('开始上传s3:' + ossPath);
        const command = new PutObjectCommand({
            Bucket: s3Bucket,
            Key: ossPath,
            ContentType: contentType
        });
        const s3Url = await getSignedUrl(getS3Object(), command);
        const response = await fetch(s3Url, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType
            },
            body: blob
        });

        if (response.ok) {
            console.log('上传s3成功');
            return true;
        } else {
            console.log('上传s3Error', response.status);
            return false;
        }
    } catch (error) {
        console.error('upload Error:', error);
        return false;
    }

}

async function deleteS3File(musicItem: IMusic.IMusicItem) {
    let result = false;
    let msg = "";
    try {
        const { ossExist, ossKeyPath } = await checkS3Exist(musicItem);
        if (!ossExist) {
            result = true;
            msg = "oss不存在";
            return { result: result, msg: msg }
        }

        msg = "delete s3";
        const command = new DeleteObjectCommand({
            Bucket: s3Bucket,
            Key: ossKeyPath,
        });
        const s3Url = await getSignedUrl(getS3Object(), command);
        const response = await fetch(s3Url, {
            method: 'DELETE',
        });
        if (!response.ok)
            throw new Error(msg);

        result = true;
        msg = "删除成功";

        return { result: result, msg: msg };

    } catch (err) {
        result = false;
        return { result: result, msg: msg };
    }

}




//取oss签名地址
async function getCosUrl(keyPath: string) {
    const url = await new Promise<string>((resolve) => {
        cosUtil.getObjectUrl({
            SecretId: getOssSecretId(), SecretKey: getOssSecretKey(),
            Bucket: getOssBucket(), Region: getOssRegion(), Key: keyPath, Method: "GET", Expires: "900"
        },
            (err, data) => {
                if (err)
                    console.log(err);
                resolve(data.Url);
            });
    });
    return url;
}


async function putCosObject(cosPath: string, data: string | Uint8Array) {
    try {
        const ossSecretId = getOssSecretId();
        const ossSecretKey = getOssSecretKey();
        const ossBucket = getOssBucket();
        const ossRegion = getOssRegion();
        let url = cosUtil.getUrl({
            bucket: ossBucket,
            region: ossRegion,
            object: cosPath,
        });
        let putBuffer: Uint8Array =
            data instanceof Uint8Array
                ? (data as Uint8Array)
                : new TextEncoder().encode(data as string);

        const headers = {
            'Content-Type': 'application/octet-stream',
            // "Content-MD5": md5,
            'Content-Length': putBuffer.length.toString(),
        };

        let authput = cosUtil.getAuth({
            SecretId: ossSecretId,

            SecretKey: ossSecretKey,

            Bucket: ossBucket,

            Region: ossRegion,

            Method: 'PUT',

            Key: cosPath,
            headers: headers,
        });

        headers["Authorization"] = authput;

        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: putBuffer
        });

        if (response.ok) {
            return true;
        } else {
            console.log(`Unexpected status code: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        return false;
    }
}

async function headCosObject(cosPath: string) {
    try {
        const ossSecretId = getOssSecretId();
        const ossSecretKey = getOssSecretKey();
        const ossBucket = getOssBucket();
        const ossRegion = getOssRegion();
        let url = cosUtil.getUrl({
            bucket: ossBucket,
            region: ossRegion,
            object: cosPath,
        });

        let auth = cosUtil.getAuth({
            SecretId: ossSecretId,

            SecretKey: ossSecretKey,

            Bucket: ossBucket,

            Region: ossRegion,

            Method: 'HEAD',

            Key: cosPath,
        });
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                "Authorization": auth as string,
            },
        });
        if (response.ok) {
            return true;
        } else {
            console.log(`Unexpected status code: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        return false;
    }
}

async function getCosObject(cosPath: string) {
    try {
        const ossSecretId = getOssSecretId();
        const ossSecretKey = getOssSecretKey();
        const ossBucket = getOssBucket();
        const ossRegion = getOssRegion();
        let url = cosUtil.getUrl({
            bucket: ossBucket,
            region: ossRegion,
            object: cosPath,
        });

        let auth = cosUtil.getAuth({
            SecretId: ossSecretId,

            SecretKey: ossSecretKey,

            Bucket: ossBucket,

            Region: ossRegion,

            Method: 'GET',

            Key: cosPath,
        });

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "Authorization": auth as string,
            }
        });
        if (response.ok) {
            return await response.text();
        } else {
            console.log(`Unexpected status code: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        return null;
    }
}

async function deleteCosObject(cosPath: string) {
    try {
        const ossSecretId = getOssSecretId();
        const ossSecretKey = getOssSecretKey();
        const ossBucket = getOssBucket();
        const ossRegion = getOssRegion();
        let url = cosUtil.getUrl({
            bucket: ossBucket,
            region: ossRegion,
            object: cosPath,
        });

        let auth = cosUtil.getAuth({
            SecretId: ossSecretId,

            SecretKey: ossSecretKey,

            Bucket: ossBucket,

            Region: ossRegion,

            Method: 'DELETE',

            Key: cosPath,
        });

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                "Authorization": auth as string,
            }
        });

        if (response.ok) {
            return true;
        } else {
            console.log(`Unexpected status code: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        return false;
    }
}



function getCosBackupKey() {
    return `${ossPathBackup}`;
}

async function dowloadCosBackupFile() {
    let url = await getCosUrl(getCosBackupKey());
    const text = (await fetch(url)).text();
    return text;
}

async function uploadCosBackupFile(backUp: string) {
    await putCosObject(getCosBackupKey(), backUp);
}




export const ossUtil = {
    setup,
    checkOssPlatform,

    getS3PathKey,
    checkS3Exist,
    getS3Url,
    uploadS3File,
    deleteS3File,

    dowloadCosBackupFile,
    uploadCosBackupFile,
};

export default ossUtil;
