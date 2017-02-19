var AWS = require('aws-sdk');
var async = require('async');
var publicIp = require('public-ip');
var reporter = require('../helpers/reporter')();

var config;
var credentials;
var settings = {};
var iam;
var ec2;
var ssm;
var standardFilter = [
{
		Name: 'tag:cloudrig',
		Values: ['true']
	}
];

function findRole(cb) {

	iam.listRoles({}, function(err, data) {
		
		if (err) {
			cb(err); 
		} else  {
			for(var i = 0; i < data.Roles.length; i++) {
				if(data.Roles[i].RoleName == "aws-ec2-spot-fleet-role") {
					cb(null, data.Roles[i]);
					break;
				}
			}
		}
	});

}

function findAMI (cb) {

	var params = {
		Owners: ['self'],
		Filters: standardFilter
	}

	ec2.describeImages(params, function(err, data) {

		if (err) {
			cb(err); 
		} else {
			cb(null, data.Images[0]);
		}

	});

}

function findSecurityGroup(cb) {
	var params = {
		Filters: standardFilter
	};

	ec2.describeSecurityGroups(params, function(err, data) {
		
		if (err) {
			cb(err); 
		} else {
			cb(null, data.SecurityGroups[0]);
		}
		
	});
}

function getActiveInstances(cb) {

	var params = {
		Filters: standardFilter.concat([{
			Name: 'instance-state-name',
			Values: ['running']
		}])
	}

	ec2.describeInstances(params, function(err, data) {
		
		if (err) {
			cb(err); 
		} else {
			cb(null, data.Reservations[0] ? data.Reservations[0].Instances : []);
		}

	});

}

function findSpotFleetInstances(SpotFleetRequestId, cb) {
	
	var params = {
		SpotFleetRequestId: SpotFleetRequestId
	}

	ec2.describeSpotFleetInstances(params, function(err, data) {
		if (err) {
			cb(err); 
		} else {
			cb(null, data.ActiveInstances);
		}

	});

}

function getPendingInstances(cb) {

	var params = {
		Filters: standardFilter.concat([{
			Name: 'instance-state-name',
			Values: ['pending']
		}])
	}

	ec2.describeInstances(params, function(err, data) {
		
		if (err) {
			cb(err); 
		} else {
			cb(null, data.Reservations[0] ? data.Reservations[0].Instances : []);
		}

	});

}

function getShuttingDownInstances(cb) {

	var params = {
		Filters: standardFilter.concat([{
			Name: 'instance-state-name',
			Values: ['shutting-down']
		}])
	}

	ec2.describeInstances(params, function(err, data) {
		
		if (err) {
			cb(err); 
		} else {
			cb(null, data.Reservations[0] ? data.Reservations[0].Instances : []);
		}

	});

}

function createTags(resourceId, cb) {

	var params = {
		Resources: [resourceId], 
		Tags: [
			{
				Key: "cloudrig", 
				Value: "true"
			}
		]
	};
	
	ec2.createTags(params, function(err, data) {
		if (err) {
			reporter.report(err.stack, "error");
		} else {
			cb(data);
		}
	});

}

// NOT IMPLEMENTED
// THEORETICAL
function createSecurityGroup(cb) {
	reporter.report("Creating security group...");
	cb(null, true);
	return;
	publicIp.v4().then(function(ip) {

		var params = {
			Description: "CloudRig",
			GroupName: "CloudRig" 
		};

		ec2.createSecurityGroup(params, function(err, data) {

			if (err) {

				reporter.report(err.stack, "error");

			} else {

				//http://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AuthorizeSecurityGroupEgress.html
				var params = {
					GroupId: data.GroupId, /* required */
					CidrIp: ip + "/32",
					FromPort: -1,
					ToPort: -1,
					IpProtocol: "all",
				};

				ec2.authorizeSecurityGroupEgress(params, function (err, data) {

					if (err) {
						reporter.report(err.stack, "error");
					} else {
						cb(data);
					}
				});

			}
			
		});

	});
	
}

// NOT IMPLEMENTED
function createRole(cb) {
	reporter.report("Creating role...");
	cb(null, true);
	return;
	var params = {
		AssumeRolePolicyDocument: "<URL-encoded-JSON>", 
		Path: "/", 
		RoleName: "CloudRig"
	};

	iam.createRole(params, function(err, data) {

		if (err) {

			reporter.report(err.stack, "error");

		} else {

			cb(data);

		}

	});

}

// NOT IMPLEMENTED
function createKeyPair(cb) {
	reporter.report("Creating key pair...");
	cb(null, true);
	return;
	var params = {
		KeyName: "cloudrig"
	};

	ec2.createKeyPair(params, function(err, data) {
		
		if (err) {

			reporter.report(err.stack, "error");

		} else {

			cb(data);

		}

	});
	
}

// NOT IMPLEMENTED
function createImage(cb) {
	reporter.report("Creating image...");
	cb(null, true);
	return;
}

function removeTags(resourceId, cb) {

	var params = {
		Resources: [resourceId], 
		Tags: [
			{
				Key: "cloudrig", 
				Value: "true"
			}
		]
	};
	
	ec2.deleteTags(params, function(err, data) {
		if (err) {
			reporter.report(err.stack, "error");
		} else {
			cb(data);
		}
	});

}

function updateImage(instanceId, amiId, cb) {
	
	var params = {
		InstanceId: instanceId,
		Name: 'cloudrig-' + new Date().getTime(),
		NoReboot: true
	};

	reporter.report("Creating image...");

	ec2.createImage(params, function(err, data) {
		
		if (err) {
			reporter.report(err.stack, "error");
		} else {
			
			reporter.report("Waiting for image to be available...");

			ec2.waitFor('imageAvailable', {
				ImageIds: [data.ImageId]
			}, function() {
				
				reporter.report("Removing tag from " + amiId);

				removeTags(amiId, function() {

					reporter.report("Adding tag to " + data.ImageId);

					createTags(data.ImageId, function() {

						cb(data);

					});

				});

			});

		}
	
	});
	
}

function start(Arn, ImageId, SecurityGroupId, cb) {

	var params = {
		SpotFleetRequestConfig: {
			IamFleetRole: Arn,
			LaunchSpecifications: [
				{
					ImageId: ImageId,
					InstanceType: "g2.2xlarge",
					KeyName: config.AWSKeyPairName,
					SecurityGroups: [ { GroupId: SecurityGroupId } ]
				}
			],
			Type: "request",
			SpotPrice: config.AWSMaxPrice || "0.4", 
			TargetCapacity: 1
		}
		
	};

	ec2.requestSpotFleet(params, function(err, data) {

		if (err) {
			reporter.report(err.stack, "error");
		} else {
			
			reporter.report("Request made: " +  data.SpotFleetRequestId);
			reporter.report("Now we wait for fulfillment...");

			var c = setInterval(function() {

				findSpotFleetInstances(data.SpotFleetRequestId, function(err, instances) {
					
					if(instances.length > 0) {
						clearInterval(c);
						c = null;

						var instanceId = instances[0].InstanceId;

						reporter.report("Got an instance: " + instanceId);
						reporter.report("Tagging instance...");
						
						createTags(instanceId, function() {
							
							reporter.report("Tagged 'cloudrig'");

							reporter.report("Now we wait for our instance to be ready...");

							var v = setInterval(function() {

								getActiveInstances(function(err, instances) {
									
									if(instances.length > 0) {
										
										clearInterval(v);
										v = null;

										reporter.report("Now we wait for our instance to be OK...");

										ec2.waitFor('instanceStatusOk', {

											InstanceIds: [ instanceId ]
											
										}, function(err, data) {
											
											if (err) { 
												reporter.report(err.stack, "error")
											} else {
												reporter.report("Ready");
												cb(null);
											}

										});
									}

								});

							}, 5000);

						});
						
					}
				});

			}, 5000);

		}
	});

	return params;

}

function stop(spotFleetRequestId, instanceId, cb) {

	reporter.report("Stopping: \t" + spotFleetRequestId);

	var params = {
		SpotFleetRequestIds: [spotFleetRequestId], 
		TerminateInstances: true
	};

	ec2.cancelSpotFleetRequests(params, function(err, data) {
		
		if (err) {
			reporter.report(err.stack, "error"); 
		} else {

			reporter.report("Waiting for instance to be terminated...");

			ec2.waitFor('instanceTerminated', {
				
				InstanceIds: [instanceId]

			}, function() {

				reporter.report("Terminated");
				cb();

			});
			
		}

	});

}

function getRequiredConfig() {
	return ["AWSCredentialsProfile", "AWSMaxPrice", "AWSRegion"]
}

function validateRequiredConfig(configValues, cb) {

	var testCredentials = new AWS.SharedIniFileCredentials({
		profile: configValues[0]
	});
	
	if(!credentials.accessKeyId) {
		cb(null, ["AWS profile not found"]);
	} else {
		cb(null, true);
	}

}

// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SSM.html#sendCommand-property
function sendMessage(commands, cb) {

	getState(function(err, state) {
		
		if(err) {
			cb(err);
			return;
		}

		var params = {
			DocumentName: "AWS-RunPowerShellScript",
			InstanceIds: [
				state.activeInstances[0].InstanceId
			],
			Parameters: {
				"commands": commands
			}
		};

		reporter.report("Sending '" + commands.join("' ") + "' to " + state.activeInstances[0].InstanceId);

		ssm.sendCommand(params, function(err, data) {
			
			// http://docs.aws.amazon.com/ssm/latest/APIReference/API_SendCommand.html
			// InvalidInstanceId


			if (err) {
				reporter.report(err.stack, "error");
			} else {
				cb(data);
			}
		});

	});
}

function getState(cb) {
	
	async.parallel([
		
		getActiveInstances,
		getPendingInstances,
		getShuttingDownInstances

	], function(err, results) {
		
		if(err) {
			cb(err);
			return;
		}

		cb(null, {
			activeInstances: results[0],
			pendingInstances: results[1],
			shuttingDownInstances: results[2]
		});

	});

}


module.exports = {
	
	id: "AWS",

	setConfig: function(_config) {
		config = _config;
	},

	setReporter: function(_reporter) {
		reporter.set(_reporter, "AWS");
	},

	// also reinit
	setup: function(cb) {
		
		credentials = new AWS.SharedIniFileCredentials({
			profile: config.AWSCredentialsProfile
		});
		
		AWS.config.credentials = credentials;
		AWS.config.region = config.AWSRegion;

		iam = new AWS.IAM();
		ec2 = new AWS.EC2();
		ssm = new AWS.SSM();
		
		async.parallel([
			findRole,
			findAMI,
			findSecurityGroup
		], function(err, results) {

			// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#createKeyPair-property
			// Check key

			// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/IAM.html#createRole-property
			var role = results[0];

			// Choose AMI
			var AMI = results[1];

			// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/EC2.html#createSecurityGroup-property
			var securityGroup = results[2]

			if(err) {
				cb("Error " + err);
				return;
			}
			
			var questions = [];

			if(!role.Arn) {
				questions.push({
					q: "Can I make a CloudRig user for you?",
					m: createRole.bind(this)
				});
			} else {
				settings.Arn = role.Arn;
			}

			if(!AMI.ImageId) {
				questions.push({
					q: "Can I make an AMI for you based off the stock CloudRig AMI?",
					m: createImage.bind(this)
				});
			} else {
				settings.ImageId = AMI.ImageId;
			}

			if(!securityGroup.GroupId) {
				questions.push({
					q: "Can I make a CloudRig security group for you?",
					m: createImage.bind(this)
				});
			} else {
				settings.SecurityGroupId = securityGroup.GroupId;
			}
			
			cb(null, questions, settings);

		});

	},

	sendMessage: sendMessage,

	getRequiredConfig: getRequiredConfig,

	validateRequiredConfig: validateRequiredConfig,

	validateRequiredSoftware: function(cb) {
		cb(null, true);
	},

	getState: getState,

	getActive: function(cb) {
		getActiveInstances(cb);
	},

	getPending: function(cb) {
		getPendingInstances(cb);
	},

	getShuttingDownInstances: function(cb) {
		getShuttingDownInstances(cb);
	},

	start: function(cb) {
		/*
		if(state.runningSpotInstance) {
			cb("You area already running an instance");
			return;	
		}
		*/
		return start(settings.Arn, settings.ImageId, settings.SecurityGroupId, cb);
	},

	stop: function(cb) {

		getState(function(err, state) {

			if(err) {
				cb(err);
				return;
			}

			var id;
			
			state.activeInstances[0].Tags.forEach(function(tag) {

				if(tag.Key === "aws:ec2spot:fleet-request-id") {
						id = tag.Value;
					}
				});

			stop(id, state.activeInstances[0].InstanceId, cb);

		});
		
		
	},

	getPublicDNS: function(cb) {

		getState(function(err, state) {
			if(err) {
				cb(err);
				return;
			}
			cb(null, state.activeInstances[0].PublicDnsName);
		});

	},

	update: function(cb) {

		getState(function(err, state) {
			
			if(err) {
				cb(err);
				return;
			}

			if(state.activeInstances.length > 0) {	
				updateImage(state.activeInstances[0].InstanceId, settings.ImageId, cb);
			} else {
				cb("There's no instance running...");
			}

		});

		

	},

	updateAndStop: function(cb) {

		updateImage(settings.ImageId, function() {
			stop(settings.ImageId, cb);	
		});

	}

}