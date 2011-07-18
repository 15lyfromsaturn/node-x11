var util = require('util'); // util.inherits
var net = require('net');

var handshake = require('./handshake');
//var xevents = require('./xevents');

var EventEmitter = require('events').EventEmitter;
var PackStream = require('./unpackstream');
var coreRequestsTemplate = require('./corereqs');
//var hexy = require('./hexy').hexy;

var Buffer = require('buffer').Buffer;
// add 'unpack' method for buffer
require('./unpackbuffer').addUnpack(Buffer);

var xerrors = require('./xerrors');
var coreRequests = require('./corereqs');

function XClient(stream)
{
    EventEmitter.call(this);
    this.stream = stream;

    this.core_requests = {};
    this.ext_requests = {};

    pack_stream = new PackStream();

    // data received from stream is dispached to
    // read requests set by calls to .unpack and .unpackTo
    //stream.pipe(pack_stream);
   
     // pack_stream write requests are buffered and
    // flushed to stream as result of call to .flush
    // TODO: listen for drain event and flush automatically 
    //pack_stream.pipe(stream);
    
    pack_stream.on('data', function( data ) {
        //console.error(hexy(data, {prefix: 'from packer '}));
        stream.write(data);
    });
    stream.on('data', function( data ) {
        //console.error(hexy(data, {prefix: 'to unpacker '}));
        pack_stream.write(data);
    });

    this.pack_stream = pack_stream;

    this.rcrc_id = 0; // generated for each new resource
    this.seq_num = 1; // incremented in each request. (even if we don't expect reply)

    // in/out packets indexed by sequence ID
    this.requests = {};
    this.replies = {};
    this.events = {};

    this.importRequestsFromTemplates(this, coreRequests);
    this.startHandshake();

    // import available extentions
    // TODO: lazy import on first call?
    /*
    this.ext = {};
    this.ListExtensions( function(err, extentionsList ) {
        for (ext in extentionsList) {
            var extRequests = require('./ext/' + extentionsList[ext]);
            // TODO: need to call QueryExtention to get [major opcode, first event, first error]
            importRequestsFromTemplates(this, extRequests);
        }
    }
    */
    // init comon extentions
    
}
util.inherits(XClient, EventEmitter);

XClient.prototype.importRequestsFromTemplates = function(target, reqs)
{
    var client = this;
    for (r in reqs)
    {
        // r is request name
        target[r] = (function(reqName) {
            var reqFunc = function req_proxy() {
            var args = Array.prototype.slice.call(req_proxy.arguments);
            // TODO: setup last argument to be reply/error callback
            // var callback = args.length > 0 ? null : args[args.length - 1];

            // TODO: see how much we can calculate in advance (not in each request)
            var reqReplTemplate = reqs[reqName];
            var reqTemplate  = reqReplTemplate[0];
            var templateType = typeof reqTemplate;

            if (templateType == 'object')
                templateType = reqTemplate.constructor.name;

            if (templateType == 'function')
            {
                 // call template with input arguments (not including callback which is last argument TODO currently with callback. won't hurt)
                 //reqPack = reqTemplate.call(args);
                 reqPack = reqTemplate.apply(this, req_proxy.arguments); 
                 var format = reqPack[0];
                 var requestArguments = reqPack[1];
                 client.pack_stream.pack(format, requestArguments);
                 client.pack_stream.flush();
            } else if (templateType == 'Array'){
                 var format = reqTemplate[0];
                 var requestArguments = reqTemplate[1];
                 for (a in args)
                     requestArguments.push(args[a]);
                 client.pack_stream.pack(format, requestArguments);
                 client.pack_stream.flush();
            } else {
                 throw 'unknown request format - ' + templateType;
            }
        }
        return reqFunc;
        })(r);
    }
}

XClient.prototype.AllocID = function()
{
    // TODO: handle overflow (XCMiscGetXIDRange from XC_MISC ext)
    // TODO: unused id buffer
    this.display.rsrc_id++;
    return (this.display.rsrc_id << this.display.rsrc_shift) + this.display.resource_base;
}

XClient.prototype.expectReplyHeader = function()
{
    var client = this;
    client.pack_stream.unpack(
       'CCSL', function(res) {
            var type = res[0];
            var seq_num = res[2];
            if (type == 0)
            {
                var error_code = res[1];              
                // unpack error packet (32 bytes for all error types, 8 of them in CCSL header)
                client.pack_stream.get(24, function(buf) {
                    // TODO: dispatch, use sequence number
                    console.error('error!!!!' + xerrors.errorText[error_code]);
                    client.expectReplyHeader();
                } ); 
                return;
            } else if (type > 1)
            {
                client.pack_stream.get(24, function(buf) {
                    // TODO: dispatch, use sequence number
                    console.error('event!!!! ' + type);
                    client.expectReplyHeader();
                } ); 
                return;
            }
            var opt_data = res[1];
            var length_total = res[3];           // in 4-bytes units, _including_ this header
            var bodylength = (length_total-2)*4; // length of the data in bytes
            client.pack_stream.get( bodylength, function( data ) {
                // TODO: decode and dispatch, use sequence number
                console.error('reply data!!!');

                // wait for new packet from server
                client.expectReplyHeader();
            });        
        } 
    );
}

XClient.prototype.startHandshake = function()
{
    var client = this;

    handshake.writeClientHello(this.pack_stream);
    handshake.readServerHello(this.pack_stream, function(display) 
    {
        // TODO: readServerHello can set erro state in display
        // emit error in that case
        client.expectReplyHeader();
        client.display = display;
        client.emit('connect', display);
    });   
}

var platformDefaultTransport = {
   win32: 'tcp',
   win64: 'tcp',
   cygwin: 'tcp',
   linux: 'unix'
   // TODO: check process.platform on SmartMachine solaris box
}

module.exports.createClient = function()
{
    // TODO: parse $DISPLAY
   
    // open stream
    var stream;
    var defaultTransportName = platformDefaultTransport[process.platform];
    console.error('Cunnecting using ' + defaultTransportName + ' socket');
    // use tcp if stated explicitly or if not defined at all
    if (!defaultTransportName || defaultTransportName == 'tcp')
        stream = net.createConnection(6000);
    if (defaultTransportName == 'unix')
        stream = net.createConnection('/tmp/.X11-unix/X0');

   return new XClient(stream);
}