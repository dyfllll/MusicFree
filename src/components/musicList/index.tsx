import React from 'react';
import {FlatListProps} from 'react-native';
import rpx from '@/utils/rpx';

import MusicItem from '../mediaItem/musicItem';
import Empty from '../base/empty';
import {FlashList} from '@shopify/flash-list';
import ListLoading from '../base/listLoading';
import ListReachEnd from '../base/listReachEnd';
import TrackPlayer from '@/core/trackPlayer';
import Config from '@/core/config';
import { useEffect, useState } from "react";

interface IMusicListProps {
    /** 顶部 */
    Header?: FlatListProps<IMusic.IMusicItem>['ListHeaderComponent'];
    /** 音乐列表 */
    musicList?: IMusic.IMusicItem[];
    /** 所在歌单 */
    musicSheet?: IMusic.IMusicSheetItem;
    /** 是否展示序号 */
    showIndex?: boolean;
    /** 点击 */
    onItemPress?: (
        musicItem: IMusic.IMusicItem,
        musicList?: IMusic.IMusicItem[],
    ) => void;
    loadMore?: 'loading' | 'done' | 'idle';
    onEndReached?: () => void;
}
const ITEM_HEIGHT = rpx(120);

let playCountStore: any = {};
let playCountStoreVaild = false;
let playCountAPIToken: string = "";
let playCountStoreSheetId = "";

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

function getMusicItemKey(item: IMusic.IMusicItem) {
    return `${item.platform}-${item.id}`;
}
function getMusicItemPlayCount(item: IMusic.IMusicItem) {
    const key = getMusicItemKey(item);
    return playCountStore[key];
}
function setMusicItemPlay(item: IMusic.IMusicItem) {
    if (!playCountStoreVaild) return false;
    const key = getMusicItemKey(item);
    playCountStore[key] = (playCountStore[key] ?? 0) + 1;

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
async function setupPlayCountStore(musicList: IMusic.IMusicItem[]) {
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
            playCountAPIToken = (await tokenResult.json()).token;
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
            body: JSON.stringify(musicList.map(it => getMusicItemKey(it)))
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        playCountStore = result.data;
        playCountStoreVaild = true;
    } catch (error: any) {
        playCountStoreVaild = false;
        throw new Error(error);
    } finally {
    }
}

/** 音乐列表 */
export default function MusicList(props: IMusicListProps) {
    const {
        Header,
        musicList,
        musicSheet,
        showIndex,
        onItemPress,
        onEndReached,
        loadMore = 'idle',
    } = props;

    // ! keyExtractor需要保证整个生命周期统一？ 有些奇怪
    // const keyExtractor = useCallback(
    //     (item: any, index: number) =>
    //         '' + index + '-' + item.platform + '-' + item.id,
    //     [],
    // );

    const [extraData, setextraData] = useState({});

    useEffect(() => {
        if (musicSheet && musicList && playCountStoreSheetId != musicSheet.id) {
            setupPlayCountStore(musicList)
                .then(_ => {
                    setextraData({});
                })
                .catch(e => console.log(e));
            playCountStoreSheetId = musicSheet.id;
        }
    }, []);

    return (
        <FlashList
            ListHeaderComponent={Header}
            ListEmptyComponent={loadMore !== 'loading' ? Empty : null}
            ListFooterComponent={
                loadMore === 'done'
                    ? ListReachEnd
                    : loadMore === 'loading'
                    ? ListLoading
                    : null
            }
            data={musicList ?? []}
            extraData={extraData}
            // keyExtractor={keyExtractor}
            estimatedItemSize={ITEM_HEIGHT}
            renderItem={({index, item: musicItem}) => {
                return (
                    <MusicItem
                        musicItem={musicItem}
                        index={showIndex ? index + 1 : undefined}
                        onItemPress={() => {
                            if (onItemPress) {
                                onItemPress(musicItem, musicList);
                            } else {
                                TrackPlayer.playWithReplacePlayList(
                                    musicItem,
                                    musicList ?? [musicItem],
                                );
                            }
                            if (setMusicItemPlay(musicItem))
                                setextraData({});
                        }}
                        musicSheet={musicSheet}
                        playCount={getMusicItemPlayCount(musicItem)}
                    />
                );
            }}
            onEndReached={() => {
                if (loadMore !== 'loading') {
                    onEndReached?.();
                }
            }}
            onEndReachedThreshold={0.1}
        />
    );
}
