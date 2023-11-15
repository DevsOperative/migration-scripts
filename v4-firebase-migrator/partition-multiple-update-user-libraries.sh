node update-user-libraries.js 1 &
pids[0]=$!
node update-user-libraries.js 10000 &
pids[1]=$!
node update-user-libraries.js 20000 &
pids[2]=$!
node update-user-libraries.js 30000 &
pids[3]=$!
node update-user-libraries.js 40000 &
pids[4]=$!
node update-user-libraries.js 50000 &
pids[5]=$!
node update-user-libraries.js 60000 &
pids[6]=$!
node update-user-libraries.js 70000 &
pids[7]=$!

for pid in ${pids[*]}; do
    wait $pid
done
