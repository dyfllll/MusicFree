/** 备份与恢复 */
/** 歌单、插件 */
import {compare} from 'compare-versions';
import PluginManager from './pluginManager';
import MusicSheet from '@/core/musicSheet';
import {ResumeMode} from '@/constants/commonConst.ts';
import ossUtil from '@/core/ossUtil';
import Toast from '@/utils/toast';
import Config from '@/core/config';

/**
 * 结果：一份大的json文件
 * {
 *     musicSheets: [],
 *     plugins: [],
 * }
 */

interface IBackJson {
    musicSheets: IMusic.IMusicSheetItem[];
    plugins: Array<{srcUrl: string; version: string}>;
}

async function setup() {
    await onUpdate();
    console.log('backup setup');
}

function backup() {
    const musicSheets = MusicSheet.backupSheets();
    const plugins = PluginManager.getValidPlugins();
    const normalizedPlugins = plugins.map(_ => ({
        srcUrl: _.instance.srcUrl,
        version: _.instance.version,
    }));

    return JSON.stringify({
        musicSheets: musicSheets,
        plugins: normalizedPlugins,
    });
}

async function resume(
    raw: string | Object,
    resumeMode: ResumeMode = ResumeMode.Append,
) {
    let obj: IBackJson;
    if (typeof raw === 'string') {
        obj = JSON.parse(raw);
    } else {
        obj = raw as IBackJson;
    }

    const {plugins, musicSheets} = obj ?? {};
    /** 恢复插件 */
    const validPlugins = PluginManager.getValidPlugins();
    const resumePlugins = plugins?.map(_ => {
        // 校验是否安装过: 同源且本地版本更高就忽略掉
        if (
            validPlugins.find(
                plugin =>
                    plugin.instance.srcUrl === _.srcUrl &&
                    compare(
                        plugin.instance.version ?? '0.0.0',
                        _.version ?? '0.0.1',
                        '>=',
                    ),
            )
        ) {
            return;
        }
        return PluginManager.installPluginFromUrl(_.srcUrl);
    });

    /** 恢复歌单 */
    const resumeMusicSheets = MusicSheet.resumeSheets(musicSheets, resumeMode);

    return Promise.all([...(resumePlugins ?? []), resumeMusicSheets]);
}

async function resumeOSS(
    raw: string | Object,
    resumeMode: ResumeMode = ResumeMode.Append,
) {
    let obj: IBackJson;
    if (typeof raw === 'string') {
        obj = JSON.parse(raw);
    } else {
        obj = raw as IBackJson;
    }

    const {plugins, musicSheets} = obj ?? {};

    /** 恢复歌单 */
    await  MusicSheet.resumeOssSheets(musicSheets, resumeMode); 
}

async function onBackup() {
    try {
        const jsonStr = backup();
        const hash = await ossUtil.uploadCosBackupFile(jsonStr);
        Config.set("setting.basic.ossAutoUpdateHash", hash)
        Toast.success('备份成功~');
    } catch (e) {
        console.log(e);
        Toast.warn(`备份失败 ${e}`);
    }
}

async function onResume() {
    try {
        const resumeMode = Config.get("setting.backup.resumeMode");
        const { hash, data } = await ossUtil.dowloadCosBackupFile();
        await resumeOSS(data, resumeMode);
        Config.set("setting.basic.ossAutoUpdateHash", hash)
        Toast.success('恢复成功~');
    } catch (e) {
        console.log(e);
        Toast.warn(`恢复失败 ${e}`);
    }
}

async function onUpdate() {
    try {
        if (Config.get("setting.basic.ossAutoUpdate")) {
            const resumeMode = Config.get("setting.backup.resumeMode");
            const remoteHash = await ossUtil.getCosBackupFileHash();
            const localHash = Config.get("setting.basic.ossAutoUpdateHash");
            console.log("remoteHash:" + remoteHash);
            console.log("localHash:" + localHash);
            if (remoteHash != localHash) {
                const { hash, data } = await ossUtil.dowloadCosBackupFile();
                await resumeOSS(data, resumeMode);
                Config.set("setting.basic.ossAutoUpdateHash", hash)
                Toast.success("自动更新歌单成功");
            }
        }
    } catch (error) {
        console.log(error);
        Toast.warn("自动更新歌单失败");
    }
}


const Backup = {
    setup,
    backup,
    resume,
    onBackup,
    onResume,
    onUpdate,
};
export default Backup;
