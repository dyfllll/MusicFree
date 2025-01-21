import 'react-native-url-polyfill/auto'; // 使 URL API 在 React Native 环境中工作
import Config, { IConfigPaths } from '@/core/config';
import { S3, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import axios from 'axios';

let oss: S3;
let ossSecretId = "";
let ossSecretKey = "";
let ossBucket = "";
let ossEndpoint = "";

const ossPathData = 'data/320k';
const ossPathBackup = 'music/backup/MusicFree/PlaylistBackup.json';

export const ossPluginName = 'oss';
export const ossPluginHash = 'oss';

let isSetup = false;

let s3Client: S3;
let s3SecretId = "";
let s3SecretKey = "";
let s3Bucket = "";
let s3Region = "us-east-1";
let s3EndpointLocal = "";
let s3EndpointRemote = "";
let netLocal = true;



async function setup() {
    let local;
    if (await getLocalState()) {
        local = true;
    } else {
        local = false;
    }
    isSetup = true;
    Config.set('setting.basic.netLocal', local);
    console.log("use s3 url:" + (local ? s3EndpointLocal : s3EndpointRemote));
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
    const endpointRemote = Config.get("setting.basic.s3EndpointRemote") ?? "";
    const local = isSetup ? Config.get("setting.basic.netLocal") ?? false : true;

    let create = false;
    create = create || s3Client == null;
    create = create || s3SecretId != secretId;
    create = create || s3SecretKey != secretKey;
    // create = create || s3Bucket != bucket;
    create = create || s3EndpointLocal != endpointLocal;
    create = create || s3EndpointRemote != endpointRemote;
    create = create || netLocal != local;

    if (create) {
        const config = {
            region: s3Region,
            credentials: {
                accessKeyId: secretId,
                secretAccessKey: secretKey,
            },
            endpoint: local ? endpointLocal : endpointRemote,
            forcePathStyle: true,
        };
        s3Client = new S3(config);
    }

    s3SecretId = secretId;
    s3SecretKey = secretKey;
    s3Bucket = bucket;
    s3EndpointLocal = endpointLocal;
    s3EndpointRemote = endpointRemote;
    netLocal = local;

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
    else { return `${ossPathData}/${getOssPathName(musicItem)}.mp3`; }
}

function getOssPathName(mediaItem: IMusic.IMusicItem) {
    return `${mediaItem.title}-${mediaItem.artist}`.replace(/[/|\\?*"<>:]/g, "_");
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



function getCosObject() {
    const secretId = Config.get('setting.basic.ossSecretId') ?? '';
    const secretKey = Config.get('setting.basic.ossSecretKey') ?? '';
    const bucket = Config.get("setting.basic.ossBucket") ?? "";
    const endpoint = Config.get("setting.basic.ossEndpoint") ?? "";

    let create = false;
    create = create || oss == null;
    create = create || ossSecretId != secretId;
    create = create || ossSecretKey != secretKey;
    create = create || ossEndpoint != endpoint;


    if (create) {
        const config = {
            region: s3Region,
            credentials: {
                accessKeyId: secretId,
                secretAccessKey: secretKey,
            },
            endpoint: endpoint,
            forcePathStyle: false,
        };
        oss = new S3(config);
    }

    ossSecretId = secretId;
    ossSecretKey = secretKey;
    ossEndpoint = endpoint;
    ossBucket = bucket;

    return oss;
}





function getCosBackupKey() {
    return `${ossPathBackup}`;
}

async function getCosBackupFileHash() {
    const client = getCosObject();
    const command = new HeadObjectCommand({
        Bucket: ossBucket,
        Key: getCosBackupKey(),
    });
    const s3Url = await getSignedUrl(client, command);
    const response = await fetch(s3Url, {
        method: 'HEAD'
    });
    return response.headers.get("ETag") ?? "";
}

async function dowloadCosBackupFile() {
    const client = getCosObject();
    const command = new GetObjectCommand({
        Bucket: ossBucket,
        Key: getCosBackupKey(),
    });
    const s3Url = await getSignedUrl(client, command);
    const response = await fetch(s3Url);
    const hash = response.headers.get("ETag") ?? "";
    const text = await response.text();
    return { hash: hash, data: text };
}

async function uploadCosBackupFile(backUp: string) {
    const client = getCosObject();
    const command = new PutObjectCommand({
        Bucket: ossBucket,
        Key: getCosBackupKey(),
    });
    const s3Url = await getSignedUrl(client, command);
    const response = await fetch(s3Url, {
        method: 'PUT',
        body: backUp
    });
    return response.headers.get("ETag") ?? "";
}


let playCountStore: any = {};
let playCountStoreVaild = false;
let playCountAPIToken: string = "";
let playCountStoreSheetId = "";
let playCountRefreshCallback = () => { };

function getAPIUrl() {
    const local = Config.get("setting.basic.netLocal") ?? true;
    let url;
    if (local) {
        url = Config.get("setting.basic.serverEndpointLocal") ?? "";
    }
    else {
        url = Config.get("setting.basic.serverEndpointRemote") ?? "";
    }
    return url;
}

function getPlayCountKey(item: IMusic.IMusicItem) {
    return `${item.platform}-${item.id}`;
}
function getPlayCount(item: IMusic.IMusicItem) {
    const key = getPlayCountKey(item);
    return playCountStore[key];
}

function setPlayCount(item: IMusic.IMusicItem) {
    if (!playCountStoreVaild) {
        return false;
    }

    const key = getPlayCountKey(item);
    playCountStore[key] = (playCountStore[key] ?? 0) + 1;

    playCountRefreshCallback();

    fetch(`${getAPIUrl()}/music/setPlayCount`, {
        method: 'POST',
        headers: {
            'Content-Type': "application/json",
            "Authorization": playCountAPIToken
        },
        body: JSON.stringify({ key: key })
    }).catch(e => { console.log(e); });

    return true;
}

async function fetchPlayCountData(musicList: IMusic.IMusicItem[]) {
    try {
        if (!playCountAPIToken) {
            const tokenResult = await fetch(`${getAPIUrl()}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': "application/json",
                    "Authorization": playCountAPIToken
                },
                body: JSON.stringify({
                    username: Config.get("setting.basic.s3SecretId"),
                    password: Config.get("setting.basic.s3SecretKey")
                })
            });
            playCountAPIToken = (await tokenResult.json()).data.token;
        }

        if (!playCountAPIToken)
            throw new Error(`error token`);

        // console.log(playCountAPIToken);

        const response = await fetch(`${getAPIUrl()}/music/getPlayCountList`, {
            method: 'POST',
            headers: {
                'Content-Type': "application/json",
                'Authorization': playCountAPIToken
            },
            body: JSON.stringify(musicList.map(it => getPlayCountKey(it)))
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.data;
    } catch (error: any) {
        throw new Error(error);
    } finally {
    }
}

function setupPlayCountStore(musicSheet: IMusic.IMusicSheetItem | undefined, musicList: IMusic.IMusicItem[] | undefined, refreshCallback: () => void) {
    if (musicSheet && musicList) {
        if (playCountStoreSheetId != musicSheet.id) {
            fetchPlayCountData(musicList)
                .then((data: any[]) => {
                    data?.forEach((item: any) => {
                        playCountStore[item.key] = item.count;
                    });
                    playCountStoreVaild = true;
                    refreshCallback();
                })
                .catch(e => {
                    console.log(e);
                    playCountStoreVaild = false;
                });
            playCountStoreSheetId = musicSheet.id;
        } else {
        }
    } else {
        playCountStoreVaild = false;
    }
    playCountRefreshCallback = refreshCallback;
}




export const ossUtil = {
    setup,
    checkOssPlatform,

    getS3PathKey,
    checkS3Exist,
    getS3Url,
    uploadS3File,
    deleteS3File,

    getCosBackupFileHash,
    dowloadCosBackupFile,
    uploadCosBackupFile,

    setupPlayCountStore,
    getPlayCount,
    setPlayCount,
};

export default ossUtil;
