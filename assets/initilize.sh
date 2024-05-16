#!/bin/bash -v
set -euo pipefail

FILE_SYSTEM_ID=$1
echo "$(date) Start..."

yum check-update -y
yum install -y \
    amazon-efs-utils\
    nfs-utils 

file_system_id_1=${FILE_SYSTEM_ID}
efs_mount_point_1="/mnt/efs/fs1"
mkdir -p "${efs_mount_point_1}"
test -f "/sbin/mount.efs" && echo "${file_system_id_1}: ${efs_mount_point_1} efs defaults,_netdev" >> /etc/fstab || echo "${file_system_id_1}.efs.ap-southeast-2.amazonaws.com:/ ${efs_mount_point_1} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0" >> /etc/fstab
mount -a -t -iam efs,nfs4 defaults

echo "$(date) Finish..."