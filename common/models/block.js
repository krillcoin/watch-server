'use strict';
var app = require('../../server/server');
const Krill = require('../../../core/dist/node.js');
const _ = require('lodash')

const HEX_ALPHABET = '0123456789abcdef';

module.exports = function(Block) {

    function toHex(buffer) {
        var hex = '';
        for (let i = 0; i < buffer.length; i++) {
            const code = buffer[i];
            hex += HEX_ALPHABET[code >>> 4];
            hex += HEX_ALPHABET[code & 0x0F];
        }
        return hex;
    }

    var $ = {};

    (async function() {

        function initApi () {
            $.blockchain.getBlocks(700, 500, true).then(function (blocks) {
                //console.log('blocks ', blocks)
            });
        }
        var nimNode = app.get('nimNode');
        console.log('nimNode ', nimNode)
        const netconfig = new Krill.WsNetworkConfig(nimNode.url, nimNode.port, nimNode.key, nimNode.cert);

        $.consensus = await Krill.Consensus.full(netconfig);

        $.blockchain = $.consensus.blockchain;
        $.accounts = $.blockchain.accounts;
        $.mempool = $.consensus.mempool;
        $.network = $.consensus.network;

        $.blockchain.on('head-changed', (head) => {
            console.log('head-changed >>>')
            var _block = {
                height: $.blockchain.height,
                timestamp: $.blockchain.head.timestamp,
                hash: $.blockchain.headHash.toHex(),
                miner_address: $.blockchain.head.minerAddr.toUserFriendlyAddress(),
                transaction_count: $.blockchain.head.transactions.length,
                difficulty: $.blockchain.head.difficulty,
                size: $.blockchain.head.serializedSize,
                reward: Krill.Policy.blockRewardAt($.blockchain.height),
                // transactions: [],
                value: 0,
                fees: 0
            };

            var _transactions = [];

            if (_block.transaction_count > 0) {
                _.each($.blockchain.head.transactions, function(transaction) {
                    _transactions.push({
                        fee: transaction.fee,
                        hash: transaction._hash.toHex(),
                        receiver_address: transaction.recipient.toUserFriendlyAddress(),
                        sender_address: transaction.sender.toUserFriendlyAddress(),
                        timestamp: _block.timestamp,
                        value: transaction.value,
                        block_height: _block.height
                    })

                    _block.value += transaction.value;
                    _block.fees += transaction.fee;

                })
            }

            var Transaction = app.models.Transaction;
        var Account = app.models.Account;

            Transaction.create(_transactions, function(err, transactions) {
                if (err) {
                    console.log('err ' , err);
                }
            })

            _.each(_transactions, function(transaction) {
                Account.findOne({where: {address: transaction.receiver_address}}, function(findErr, existingAccount) {
                    if (findErr) {
                        console.log('findErr ' , findErr);
                    }

                    var _accountObj = {}

                    if (existingAccount) {
                        console.log('existingAccount.balance ', existingAccount.balance )
                        _accountObj = existingAccount;
                        _accountObj.balance = existingAccount.balance + transaction.value;
                    } else {
                        _accountObj.address = transaction.receiver_address;
                        _accountObj.balance = transaction.value;
                    }

                    Account.upsert(_accountObj, function(upsertErr, newAccount) {
                        if (upsertErr) {
                            console.log('upsertErr ' , upsertErr);
                        }
                    })
                })
                Account.findOne({where: {address: transaction.sender_address}}, function(findErr, existingAccount) {
                    if (findErr) {
                        console.log('findErr ' , findErr);
                    }

                    var _accountObj = {}

                    if (existingAccount) {
                        console.log('existingAccount.balance ', existingAccount.balance )
                        _accountObj = existingAccount;
                        _accountObj.balance = existingAccount.balance - transaction.value;
                    }

                    Account.upsert(_accountObj, function(upsertErr, newAccount) {
                        if (upsertErr) {
                            console.log('upsertErr ' , upsertErr);
                        }
                    })
                })
            })


            Account.findOne({where: {address: _block.miner_address}}, function(findErr, existingAccount) {
                if (findErr) {
                    console.log('findErr ' , findErr);
                }

                var _accountObj = {}

                if (existingAccount) {
                    console.log('existingAccount.balance ', existingAccount.balance )
                    _accountObj = existingAccount;
                    _accountObj.balance = existingAccount.balance + _block.fees + _block.reward;
                } else {
                    _accountObj.address = _block.miner_address;
                    _accountObj.balance = _block.reward + _block.fees;
                }

                Account.upsert(_accountObj, function(upsertErr, newAccount) {
                    if (upsertErr) {
                        console.log('upsertErr ' , upsertErr);
                    }
                })
            })

            Block.upsertWithWhere({height: _block.height}, _block, function(err, instance) {

                if (err) {
                    console.log('err ' , err)
                }
            })

            if ($.consensus.established || head.height % 100 === 0) {
                console.log(`Now at block: ${head.height}`);
            }
        });

        $.network.on('peer-joined', (peer) => {
            console.log(`Connected to ${peer.peerAddress.toString()}`);
        });

        $.network.connect();

        $.consensus.on('established', () => initApi());
        $.consensus.on('lost', () => console.log('concensus lost'));




    })().catch(e => {
        console.error(e);
        process.exit(1);
    });

    Block.latest = function(cb) {
        Block.find({limit: 20, order: 'timestamp DESC'}, function(err, blocks) {
            cb(null, blocks);
        });
    };

    Block.remoteMethod('latest', {
        returns: { type: 'array', root: true},
        http: {path: '/latest', verb: 'get'}
    });

    Block.height = function(_height, cb) {
        console.log('_height ', _height)
        Block.findOne({where: {height: _height}}  , function(err, block) {
            cb(null, block);
        });
    };

    Block.remoteMethod('height', {
        returns: { type: 'object', root: true},
        accepts: {arg: 'height', type: 'string', required: true},
        http: {path: '/height/:height', verb: 'get'}
    });

    Block.hash = function(_hash, cb) {
        console.log('_hash ', _hash)
        Block.findOne({where: {hash: _hash.toLowerCase()}}  , function(err, block) {
            cb(null, block);
        });
    };

    Block.remoteMethod('hash', {
        returns: { type: 'object', root: true},
        accepts: {arg: 'hash', type: 'string', required: true},
        http: {path: '/hash/:hash', verb: 'get'}
    });

    Block.difficulty = function(_range, cb) {
        console.log('_range ', _range)
        //get time now
        var _timeNow = Math.floor(Date.now() / 1000);
        //get time now - 24 hours
        var _timeAgo, _timeSplit;

        switch (_range) {
            case 'day':
                _timeAgo = _timeNow - (60 * 60 * 24);
                _timeSplit = 60 * 15 // 15min
                break;
            case 'week':
                _timeAgo = _timeNow - (60 * 60 * 24 * 7);
                _timeSplit = 60 * 60// 1hr
                break;
            case 'month':
                _timeAgo = _timeNow - (60 * 60 * 24 * 30);
                _timeSplit = 60 * 60 * 4 // 4hr
                break;
            case 'year':
                _timeAgo = _timeNow - (60 * 60 * 24 * 365);
                _timeSplit = 60 * 60 * 48 // 2 days
                break;
            default:
                _timeAgo = _timeNow - (60 * 60 * 24 * 30);
                _timeSplit = 900
                break;
        }

        //find where timestamp between now and last 24hours
        Block.find({where: {timestamp: {between: [_timeAgo,_timeNow]}}, fields: ['height', 'difficulty', 'timestamp']}  , function(err, blocks) {
            var intervalObjs = {}
            var intervals = []

            _.each(blocks, function(block) {
                var _interval = block.timestamp - (block.timestamp % _timeSplit)
                if (!intervalObjs[_interval]) {
                    intervalObjs[_interval] = {
                        timestamp: _interval,
                        height: block.height,
                        difficulty: block.difficulty
                    }
                } else {
                    intervalObjs[_interval].height = intervalObjs[_interval].height < block.height ? block.height : intervalObjs[_interval].height;
                    intervalObjs[_interval].difficulty += block.difficulty
                }
            })

            _.each(Object.keys(intervalObjs), function(_key) {
                console.log('_key ', _key)
                intervals.push(intervalObjs[_key])
            })
            cb(null, intervals);
        });
    };

    Block.remoteMethod('difficulty', {
        returns: { type: 'object', root: true},
        accepts: {arg: 'range', type: 'string', required: true},
        http: {path: '/statistics/difficulty/:range', verb: 'get'}
    });

    Block.miners = function(_range, cb) {
        console.log('_range ', _range)
        //get time now
        var _timeNow = Math.floor(Date.now() / 1000);
        //get time now - 24 hours
        var _timeAgo;

        switch (_range) {
            case 1:
                _timeAgo = _timeNow - (60 * 60 * 1);
                break;
            case 2:
                _timeAgo = _timeNow - (60 * 60 * 2);
                break;
            case 12:
                _timeAgo = _timeNow - (60 * 60 * 12);
                break;
            case 24:
                _timeAgo = _timeNow - (60 * 60 * 25);
                break;
            default:
                _timeAgo = _timeNow - (60 * 60 * 1);
                break;
        }

        //find where timestamp between now and last 24hours
        Block.find({where: {timestamp: {between: [_timeAgo,_timeNow]}}, fields: ['miner_address', 'timestamp']}  , function(err, blocks) {
            var intervalObjs = {}
            var intervals = []

            _.each(blocks, function(block) {
                if (!intervalObjs[block.miner_address]) {
                    intervalObjs[block.miner_address] = {
                        miner_address: block.miner_address,
                        blocks_mined: 1
                    }
                } else {
                    intervalObjs[block.miner_address].blocks_mined += 1
                }
            })

            _.each(Object.keys(intervalObjs), function(_key) {
                intervals.push(intervalObjs[_key])
            })
            cb(null, intervals);
        });
    };

    Block.remoteMethod('miners', {
        returns: { type: 'object', root: true},
        accepts: {arg: 'range', type: 'string', required: true},
        http: {path: '/statistics/miners/:range', verb: 'get'}
    });

};
