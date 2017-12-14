var fs = require('fs');
var cluster = require('cluster');
var os = require('os');

var redis = require('redis');

require('heapdump');

require('./lib/configReader.js');

require('./lib/logger.js');


global.redisClient = redis.createClient(config.redis.port, config.redis.host, {auth_pass: config.redis.auth});


if (cluster.isWorker){
    switch(process.env.workerType){
        case 'pool':
            require('./lib/pool.js');
            break;
        case 'blockUnlocker':
            require('./lib/blockUnlocker.js');
            break;
        case 'paymentProcessor':
            require('./lib/paymentProcessor.js');
            break;
        case 'api':
            require('./lib/api.js');
            break;
        case 'cli':
            require('./lib/cli.js');
            break
    }
    return;
}

var logSystem = 'master';
require('./lib/exceptionWriter.js')(logSystem);


var singleModule = (function(){

    var validModules = ['pool', 'api', 'unlocker', 'payments'];

    for (var i = 0; i < process.argv.length; i++){
        if (process.argv[i].indexOf('-module=') === 0){
            var moduleName = process.argv[i].split('=')[1];
            if (validModules.indexOf(moduleName) > -1)
                return moduleName;

            log('error', logSystem, 'Invalid module "%s", valid modules: %s', [moduleName, validModules.join(', ')]);
            process.exit();
        }
    }
})();


(function init(){

    checkRedisVersion(function(){

        if (singleModule){
            log('info', logSystem, 'Running in single module mode: %s', [singleModule]);

            switch(singleModule){
                case 'pool':
                    spawnPoolWorkers();
                    break;
                case 'unlocker':
                    spawnBlockUnlocker();
                    break;
                case 'payments':
                    spawnPaymentProcessor();
                    break;
                case 'api':
                    spawnApi();
                    break;
            }
        }
        else{
            spawnPoolWorkers();
            spawnBlockUnlocker();
            spawnPaymentProcessor();
            spawnApi();
        }

        spawnCli();

    });
})();


function checkRedisVersion(callback){

    redisClient.info(function(error, response){
        if (error){
            log('error', logSystem, 'Redis version check failed');
            return;
        }
        var parts = response.split('\r\n');
        var version;
        var versionString;
        for (var i = 0; i < parts.length; i++){
            if (parts[i].indexOf(':') !== -1){
                var valParts = parts[i].split(':');
                if (valParts[0] === 'redis_version'){
                    versionString = valParts[1];
                    version = parseFloat(versionString);
                    break;
                }
            }
        }
        if (!version){
            log('error', logSystem, 'Could not detect redis version - must be super old or broken');
            return;
        }
        else if (version < 2.6){
            log('error', logSystem, "You're using redis version %s the minimum required version is 2.6. Follow the damn usage instructions...", [versionString]);
            return;
        }
        callback();
    });
}

function spawnCluster({ clusters, workerType, onWorker }) {
    var numForks = (function(){
        if (!clusters)
            return 1;
        if (clusters === 'auto')
            return os.cpus().length;
        if (isNaN(clusters))
            return 1;
        return clusters;
    })();

    var workers = {};

    var createWorker = function(forkId){
        var worker = cluster.fork({
            workerType: workerType,
            forkId: forkId
        });
        worker.forkId = forkId;
        worker.type = workerType;
        workers[forkId] = worker;
        worker.on('exit', function(code, signal){
            log('error', logSystem, 'Fork %s of %s died, spawning replacement worker...',
                [forkId, workerType]);
            setTimeout(function(){
                createWorker(forkId);
            }, 2000);
        });
        if(typeof onWorker == 'function') {
            onWorker(worker);
        }
    };

    var i = 1;
    var spawnInterval = setInterval(function(){
        createWorker(i.toString());
        i++;
        if (i - 1 === numForks){
            clearInterval(spawnInterval);
            log('info', logSystem, 'Workers for %s spawned on %d thread(s)',
                [workerType, numForks]);
        }
    }, 10);
}

function spawnPoolWorkers(){

    if (!config.poolServer || !config.poolServer.enabled || !config.poolServer.ports || config.poolServer.ports.length === 0) return;

    if (config.poolServer.ports.length === 0){
        log('error', logSystem, 'Pool server enabled but no ports specified');
        return;
    }

    spawnCluster({
        clusters: config.poolServer.clusterForks,
        workerType: 'pool',
        onWorker: function(worker) {
            worker.on('message', function(msg){
                switch(msg.type){
                case 'banIP':
                    Object.keys(cluster.workers).forEach(function(id) {
                        if (cluster.workers[id].type === 'pool') {
                            cluster.workers[id].send({type: 'banIP', ip: msg.ip});
                        }
                    });
                    break;
                }
            });
        }
    });
}

function spawnBlockUnlocker(){

    if (!config.blockUnlocker || !config.blockUnlocker.enabled) return;

    var worker = cluster.fork({
        workerType: 'blockUnlocker'
    });
    worker.on('exit', function(code, signal){
        log('error', logSystem, 'Block unlocker died, spawning replacement...');
        setTimeout(function(){
            spawnBlockUnlocker();
        }, 2000);
    });

}

function spawnPaymentProcessor(){

    if (!config.payments || !config.payments.enabled) return;

    var worker = cluster.fork({
        workerType: 'paymentProcessor'
    });
    worker.on('exit', function(code, signal){
        log('error', logSystem, 'Payment processor died, spawning replacement...');
        setTimeout(function(){
            spawnPaymentProcessor();
        }, 2000);
    });
}

function spawnApi(){
    if (!config.api || !config.api.enabled) return;

    spawnCluster({
        clusters: config.api.clusterForks,
        workerType: 'api'
    });
}

function spawnCli(){

}
